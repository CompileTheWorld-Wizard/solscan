/**
 * Pool Monitoring Service
 * Monitors pool transactions using streaming
 * Tracks price and market cap changes and calculates peak values
 */

import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { dbService } from '../database';
import { redisService } from './redisService';
import { convertEventToTrackerFormat } from './eventConverter';
import { ParsedEvent, ParsedTransaction } from './type';
import { extractBondingCurveForEvent } from './utils/transactionUtils';
import { StreamerService } from './streamerService';

// const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// Keep-alive address to maintain connection even when no pools are being tracked
const KEEP_ALIVE_ADDRESS = 'So22222222222222222222222222222222222222222';

interface PeakData {
  peakPriceSol: number;
  peakPriceUsd: number;
  peakMarketCap: number;
  timestamp: number;
}

interface TimeseriesDataPoint {
  timestamp: string;
  marketcap: number | null;
  tokenPriceSol: number | null;
  tokenPriceUsd: number | null;
  poolAddress: string | null;
  sessionKey: string | null;
  signature: string | null;
  transactionType?: string | null; // 'BUY' or 'SELL' for counting buy transactions
}

interface MonitoringSession {
  walletAddress: string;
  tokenAddress: string;
  poolAddress: string;
  startTime: number;
  maxDuration: number; // in seconds
  stopSignal: boolean;
  timeseriesData: TimeseriesDataPoint[]; // Store timeseries data in memory
  timeoutId: NodeJS.Timeout | null;
  stopAfterSellTimeout: NodeJS.Timeout | null;
  processedSignatures: Set<string>; // Track processed transaction signatures to avoid duplicates
  firstBuyTxId: string | null; // First buy transaction ID
  firstSellTxId: string | null; // First sell transaction ID
}

class LiquidityPoolMonitor {
  accountCoder: BorshAccountsCoder;
  solanaConnection: Connection;
  sessions: Map<string, MonitoringSession>; // Key: walletAddress-tokenAddress-timestamp
  poolToSessions: Map<string, Set<string>>; // Key: poolAddress, Value: Set of sessionKeys
  monitoredPools: Set<string>; // Track which pool addresses we're monitoring
  private streamerService: StreamerService | null = null;
  private grpcUrl: string;
  private xToken: string;
  private lastSlot: number | null = null; // Track last processed slot for reconnection
  private fromSlot: number | null = null; // Slot to start from (for first buy recovery)
  private isShuttingDown: boolean = false; // Flag to prevent error handling during shutdown

  constructor(solanaConnection: Connection) {
    this.solanaConnection = solanaConnection;
    this.sessions = new Map();
    this.poolToSessions = new Map();
    this.monitoredPools = new Set();

    // Always add keep-alive address to maintain connection
    this.monitoredPools.add(KEEP_ALIVE_ADDRESS);
    console.log(`🔗 Added keep-alive address ${KEEP_ALIVE_ADDRESS.substring(0, 8)}... to maintain connection`);

    // Get gRPC credentials from environment
    if (!process.env.GRPC_URL || !process.env.X_TOKEN) {
      throw new Error("Missing GRPC_URL or X_TOKEN environment variables for pool monitoring");
    }
    this.grpcUrl = process.env.GRPC_URL;
    this.xToken = process.env.X_TOKEN;

    // Initialize streamer
    this.initializeStreamer();
  }


  /**
   * Initialize the streamer
   */
  private initializeStreamer(): void {
    try {
      this.streamerService = new StreamerService();
      this.streamerService.initialize(this.grpcUrl, this.xToken);
      
      // Set up callback for events
      this.streamerService.onData((tx: ParsedTransaction) => {
        this.handleTransaction(tx);
      });
      
      // Set up error callback for manual reconnection
      this.streamerService.onError((error: any) => {
        console.error('❌ Pool monitoring streamer error:', error);
        console.log('Monitored pools:', this.monitoredPools);
        this.handleStreamerError(error);
      });

      // Add keep-alive address to streamer immediately to maintain connection
      this.streamerService.addAddresses([KEEP_ALIVE_ADDRESS]);
      
      // Start streamer immediately with keep-alive address to maintain connection
      this.streamerService.enableAutoReconnect(true);
      this.streamerService.start();
      
      console.log("✅ Pool monitoring streamer initialized and started with keep-alive address");
    } catch (error: any) {
      console.error('Failed to initialize pool monitoring streamer:', error?.message || error);
    }
  }

  /**
   * Handle streamer errors and reconnect from lastSlot
   */
  private handleStreamerError(error: any): void {
    if (!this.streamerService) {
      return;
    }

    // Ignore errors if we're shutting down or already stopped
    if (this.isShuttingDown || !this.streamerService.getIsStreaming()) {
      return;
    }
  }

  /**
   * Handle transactions from streamer
   */
  private handleTransaction(tx: ParsedTransaction): void {
    try {
      // Update lastSlot from transaction
      if (tx?.transaction?.slot) {
        const slot = typeof tx.transaction.slot === 'string' 
          ? parseInt(tx.transaction.slot, 10) 
          : tx.transaction.slot;
        if (!isNaN(slot)) {
          this.lastSlot = slot;
        }
      }

      const events = tx?.transaction?.message?.events;
      if (!events || events.length === 0) {
        return;
      }

      const signature = tx?.transaction?.signatures?.[0];
      const slot = tx?.transaction?.slot;
      const createdAt = tx?.createdAt;

      // Process each event
      for (const event of events) {
        // Only process PumpFun and PumpAmm events
        if (event.name !== "TradeEvent" && event.name !== "BuyEvent" && event.name !== "SellEvent") {
          continue;
        }

        // Convert event to tracker format
        const result = convertEventToTrackerFormat(
          event as ParsedEvent,
          signature,
          slot,
          createdAt
        );

        if (!result || !result.price) {
          continue;
        }

        // For PumpFun transactions, extract bonding_curve from compiledInstructions
        // by matching the event's mint with the instruction's mint
        // and set it as pool if not already set
        if (result.platform === "PumpFun" && !result.pool) {
          const bondingCurve = extractBondingCurveForEvent(tx, event);
          if (bondingCurve) {
            result.pool = bondingCurve;
          }
        }

        // Get pool address from result
        const poolAddress = result.pool || null;
        if (!poolAddress) {
          continue;
        }

        // Skip keep-alive address - it's only used to maintain connection
        if (poolAddress === KEEP_ALIVE_ADDRESS) {
          continue;
        }

        // Only process if this pool address is being monitored
        if (!this.monitoredPools.has(poolAddress)) {
          continue;
        }

        // Extract token address for buy/sell events
        let tokenAddress: string | null = null;
        const txType = result.type?.toUpperCase();
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        
        if (txType === 'BUY') {
          tokenAddress = result.mintTo && result.mintTo !== SOL_MINT ? result.mintTo : null;
        } else if (txType === 'SELL') {
          tokenAddress = result.mintFrom && result.mintFrom !== SOL_MINT ? result.mintFrom : null;
        }

        // For PumpAmm events, fetch token mint from pool account if not available
        if (!tokenAddress && result.platform === "PumpFun Amm" && result.pool) {
          // Fetch token mint asynchronously
          this.fetchTokenMintFromPool(result.pool).then(mint => {
            if (mint) {
              // Update result with token mint
              if (txType === 'BUY') {
                result.mintTo = mint;
              } else if (txType === 'SELL') {
                result.mintFrom = mint;
              }
              
              // Process the transaction with the updated token address
              this.handlePoolUpdate(result, mint, signature || null, createdAt || null);
            }
          }).catch(error => {
            console.error(`Error fetching token mint from pool:`, error?.message || error);
          });
          
          continue;
        }

        if (!tokenAddress) {
          continue;
        }

        // Process the pool update
        this.handlePoolUpdate(result, tokenAddress, signature || null, createdAt || null);
      }
    } catch (error: any) {
      console.error(`❌ Error handling transaction in pool monitoring:`, error?.message || error);
    }
  }

  /**
   * Fetch token mint from PumpAmm pool account
   */
  private async fetchTokenMintFromPool(poolAddress: string): Promise<string | null> {
    if (!this.solanaConnection || !poolAddress) {
      return null;
    }

    try {
      const poolPublicKey = new PublicKey(poolAddress);
      const accountInfo = await this.solanaConnection.getAccountInfo(poolPublicKey);
      
      if (!accountInfo || !accountInfo.data) {
        return null;
      }

      // PumpAmm pool account structure: base_mint is at offset 33 (after pool_bump: u8, index: u16, creator: pubkey)
      if (accountInfo.data.length >= 65) {
        const baseMintBytes = accountInfo.data.slice(33, 65);
        const baseMint = new PublicKey(baseMintBytes);
        return baseMint.toString();
      }
    } catch (error: any) {
      console.error(`Failed to fetch token mint from pool ${poolAddress}:`, error?.message || error);
    }

    return null;
  }

  async calculatePriceAndMarketCap(
    poolAddress: string,
    tokenAddress: string,
    decodedData: any
  ): Promise<{ priceSol: number; priceUsd: number; marketCap: number } | null> {
    try {
      // Get SOL price from Redis
      const solPriceUsd = await redisService.getLatestSolPrice();
      if (!solPriceUsd) {
        console.log('⚠️ Failed to fetch SOL price from Redis for pool monitoring');
        return null;
      }

      // Calculate price based on pool reserves
      let priceSol = 0;
      
      // Try to extract reserves from decoded data
      const virtualSolReserves = decodedData.virtual_sol_reserves || decodedData.sol_reserves || decodedData.base_reserves;
      const virtualTokenReserves = decodedData.virtual_token_reserves || decodedData.token_reserves || decodedData.quote_reserves;

      if (virtualSolReserves && virtualTokenReserves) {
        // For pump.fun: price = sol_reserves / token_reserves
        const sol = Number(virtualSolReserves) / 1_000_000_000;
        const tokens = Number(virtualTokenReserves) / 1_000_000; // Assuming 6 decimals for tokens
        if (tokens > 0) {
          priceSol = sol / tokens;
        }
      } else {
        // Try alternative structure
        const baseReserves = decodedData.pool_base_token_reserves || decodedData.base_reserves;
        const quoteReserves = decodedData.pool_quote_token_reserves || decodedData.quote_reserves;
        
        if (baseReserves && quoteReserves) {
          const base = Number(baseReserves) / 1_000_000_000; // SOL
          const quote = Number(quoteReserves) / 1_000_000; // Tokens
          if (quote > 0) {
            priceSol = base / quote;
          }
        }
      }

      if (priceSol === 0) {
        return null;
      }

      const priceUsd = priceSol * solPriceUsd;

      // Get total supply
      try {
        const mintPublicKey = new PublicKey(tokenAddress);
        const tokenSupply = await this.solanaConnection.getTokenSupply(mintPublicKey);
        
        if (tokenSupply && tokenSupply.value) {
          const rawSupply = parseFloat(tokenSupply.value.amount);
          const decimals = tokenSupply.value.decimals;
          const totalSupply = rawSupply / Math.pow(10, decimals);
          const marketCap = totalSupply * priceUsd;

          return { priceSol, priceUsd, marketCap };
        }
      } catch (error) {
        console.error('Failed to fetch token supply:', error);
      }

      return { priceSol, priceUsd, marketCap: 0 };
    } catch (error) {
      console.error('Error calculating price and market cap:', error);
      return null;
    }
  }

  /**
   * Handle pool updates from streamer
   */
  async handlePoolUpdate(
    result: any,
    tokenAddress: string,
    signature: string | null,
    createdAt: string | null
  ): Promise<void> {
    try {
      if (!result || !result.price) {
        console.log(`⚠️ No price found in transaction result`);
        return;
      }

      // Get pool address from result
      const poolAddress = result.pool || null;
      if (!poolAddress) {
        return;
      }

      // First check if this pool is still being monitored
      if (!this.monitoredPools.has(poolAddress)) {
        // Pool was removed from monitoring, ignore this update
        return;
      }

      // Find all sessions monitoring this pool
      const sessionKeys = this.poolToSessions.get(poolAddress);
      if (!sessionKeys || sessionKeys.size === 0) {
        // No sessions for this pool - remove it from monitoring
        // But never remove the keep-alive address
        if (poolAddress !== KEEP_ALIVE_ADDRESS) {
          this.monitoredPools.delete(poolAddress);
          this.poolToSessions.delete(poolAddress);
          // Remove pool address from streamer
          if (this.streamerService) {
            this.streamerService.removeAddresses([poolAddress]);
          }
          console.log(`🧹 Cleaned up orphaned pool ${poolAddress.substring(0, 8)}... (no sessions)`);
          // Update streamer addresses (keep-alive ensures connection stays alive)
          this.updateStreamerAddresses();
        } else {
          console.log(`🔗 Keep-alive address ${poolAddress.substring(0, 8)}... remains active to maintain connection`);
        }
        return;
      }
      
      // Clean up stale session references
      const validSessionKeys = Array.from(sessionKeys).filter(key => this.sessions.has(key));
      if (validSessionKeys.length !== sessionKeys.size) {
        // Remove stale references
        sessionKeys.forEach(key => {
          if (!this.sessions.has(key)) {
            sessionKeys.delete(key);
          }
        });
        // If no valid sessions remain, remove pool
        // But never remove the keep-alive address
        if (sessionKeys.size === 0) {
          if (poolAddress !== KEEP_ALIVE_ADDRESS) {
            this.monitoredPools.delete(poolAddress);
            this.poolToSessions.delete(poolAddress);
            // Remove pool address from streamer
            if (this.streamerService) {
              this.streamerService.removeAddresses([poolAddress]);
            }
            console.log(`🧹 Cleaned up pool ${poolAddress.substring(0, 8)}... (all sessions were stale)`);
            // Update streamer addresses (keep-alive ensures connection stays alive)
            this.updateStreamerAddresses();
          } else {
            console.log(`🔗 Keep-alive address ${poolAddress.substring(0, 8)}... remains active to maintain connection`);
          }
          return;
        }
      }

      // Get token price in SOL from parseTransaction result
      const tokenPriceSol = result.price ? parseFloat(result.price.toString()) : null;
      if (tokenPriceSol === null || isNaN(tokenPriceSol)) {
        console.log(`⚠️ No valid price found in transaction result for token ${tokenAddress.substring(0, 8)}...`);
        return;
      }
      
      // Get SOL price from Redis to calculate USD price and market cap
      const solPriceUsd = await redisService.getLatestSolPrice();
      if (!solPriceUsd) {
        console.log('⚠️ Failed to fetch SOL price from Redis for pool monitoring');
        return;
      }

      const priceUsd = tokenPriceSol * solPriceUsd;
      
      // Validate priceUsd
      if (!priceUsd || isNaN(priceUsd) || !isFinite(priceUsd) || priceUsd <= 0) {
        return;
      }

      // Calculate market cap once for this token (all sessions share the same token)
      // Check if this is PumpFun or PumpAmm - they have fixed supply of 1 billion (1,000,000,000) with 6 decimals
      const platform = result.platform;
      const isPumpFunOrPumpAmm = platform === "PumpFun" || platform === "PumpFun Amm";
      
      let marketCap = 0;
      
      if (isPumpFunOrPumpAmm) {
        // PumpFun/PumpAmm tokens have fixed supply of 1 billion
        const totalSupply = 1_000_000_000; // 1 billion tokens
        marketCap = totalSupply * priceUsd;
      } else {
        // For other platforms, fetch token supply from RPC
        try {
          const mintPublicKey = new PublicKey(tokenAddress);
          const tokenSupply = await this.solanaConnection.getTokenSupply(mintPublicKey);
          
          if (tokenSupply && tokenSupply.value) {
            const rawSupply = parseFloat(tokenSupply.value.amount);
            const decimals = tokenSupply.value.decimals;
            
            if (!isNaN(rawSupply) && isFinite(rawSupply) && rawSupply > 0 && 
                !isNaN(decimals) && decimals >= 0 && decimals <= 18) {
              const totalSupply = rawSupply / Math.pow(10, decimals);
              
              if (totalSupply > 0 && isFinite(totalSupply)) {
                marketCap = totalSupply * priceUsd;
              }
            }
          }
        } catch (error) {
          console.error(`❌ Failed to fetch token supply for ${tokenAddress.substring(0, 8)}...:`, error);
        }
      }

      // Get token address from result or session
      // Process update for each session monitoring this pool
      for (const sessionKey of sessionKeys) {
        const session = this.sessions.get(sessionKey);
        if (!session) {
          continue;
        }

        // Deduplicate: Check if we've already processed this transaction signature
        if (signature && session.processedSignatures.has(signature)) {
          console.log(`⏭️ Skipping duplicate transaction ${signature.substring(0, 8)}... for session ${sessionKey.substring(0, 20)}...`);
          continue;
        }

        // Mark this signature as processed
        if (signature) {
          session.processedSignatures.add(signature);
        }

        // Get token address from session (should match the tokenAddress parameter)
        const sessionTokenAddress = session.tokenAddress;
        
        // Validate that session token address matches (safety check)
        if (sessionTokenAddress !== tokenAddress) {
          // Session token address mismatch - skip this update
          continue;
        }

        // Use createdAt timestamp from stream (slot timestamp) if available, otherwise fallback to current time
        // createdAt is in ISO format: "2025-11-23T06:44:25.792Z"
        let timestamp: number;
        let timestampISO: string;
        if (createdAt) {
          // Convert ISO timestamp to Unix epoch milliseconds
          timestamp = new Date(createdAt).getTime();
          timestampISO = createdAt;
        } else {
          // Fallback to current time if createdAt is not available
          timestamp = Date.now();
          timestampISO = new Date(timestamp).toISOString();
        }

        // Only store timeseries data if it's after the wallet's buy timestamp
        // This excludes events before the self buy event
        if (timestamp <= session.startTime) {
          // Skip events before or at the wallet's buy timestamp
          return;
        }

        // Store timeseries data in memory (will be saved to database when monitoring finishes)
        // Get transaction type from parsed result
        const txType = result.type?.toUpperCase() || null;
        
        // Only store marketcap if it's a valid positive number
        // Use null if calculation failed (marketCap is 0 due to error)
        const marketcapValue = (marketCap > 0 && isFinite(marketCap)) ? marketCap : null;
        
        session.timeseriesData.push({
          timestamp: timestampISO,
          marketcap: marketcapValue,
          tokenPriceSol: tokenPriceSol || null,
          tokenPriceUsd: priceUsd || null,
          poolAddress: poolAddress || null,
          sessionKey: sessionKey || null,
          signature: signature || null,
          transactionType: txType
        });

        const mcapDisplay = marketcapValue ? `$${marketcapValue.toFixed(2)}` : 'N/A';
        console.log(`📊 Token ${tokenAddress.substring(0, 8)}... | Price: ${tokenPriceSol.toFixed(10)} SOL ($${priceUsd.toFixed(6)}) | MCap: ${mcapDisplay}, txid: ${signature ? signature.substring(0, 8) : 'N/A'}`);
      }
    } catch (error) {
      console.error('Error handling pool update:', error);
    }
  }

  /**
   * Start the streamer if not already running
   */
  private startStreamerIfNeeded(): void {
    if (!this.streamerService) {
      console.warn('⚠️ Streamer not initialized');
      return;
    }

    // Ensure keep-alive address is always present
    if (!this.monitoredPools.has(KEEP_ALIVE_ADDRESS)) {
      this.monitoredPools.add(KEEP_ALIVE_ADDRESS);
      this.streamerService.addAddresses([KEEP_ALIVE_ADDRESS]);
      console.log(`🔗 Added keep-alive address to maintain connection`);
    }

    // Always allow starting (keep-alive address ensures we have at least one address)
    // Reset shutdown flag when starting
    this.isShuttingDown = false;

    if (!this.streamerService.getIsStreaming()) {
      try {
        // If fromSlot is set, start from that slot
        if (this.fromSlot !== null) {
          this.streamerService.enableAutoReconnect(false);
          this.streamerService.setFromSlot(this.fromSlot);
          this.streamerService.start();
          console.log(`📍 Started pool monitoring streamer from slot ${this.fromSlot}`);
        } else {
          // Start normally (from current slot)
          this.streamerService.enableAutoReconnect(true);
          this.streamerService.start();
          console.log(`✅ Started pool monitoring streamer`);
        }
      } catch (error: any) {
        console.error('Failed to start pool monitoring streamer:', error?.message || error);
      }
    }
  }

  /**
   * Stop the streamer
   */
  private stopStreamer(): void {
    if (!this.streamerService) {
      return;
    }

    // Set shutdown flag to prevent error handling during shutdown
    this.isShuttingDown = true;

    if (this.streamerService.getIsStreaming()) {
      try {
        console.log('✅ Stopped pool monitoring streamer');
      } catch (error: any) {
        console.error('Failed to stop pool monitoring streamer:', error?.message || error);
      }
    }
  }

  /**
   * Update streamer addresses when pools are added/removed
   */
  private updateStreamerAddresses(): void {
    if (!this.streamerService) {
      return;
    }

    // Ensure keep-alive address is always present
    if (!this.monitoredPools.has(KEEP_ALIVE_ADDRESS)) {
      this.monitoredPools.add(KEEP_ALIVE_ADDRESS);
      this.streamerService.addAddresses([KEEP_ALIVE_ADDRESS]);
      console.log(`🔗 Added keep-alive address to maintain connection`);
    }

    // Never stop the streamer - keep-alive address ensures connection stays alive
    // Reset shutdown flag if we're adding pools back
    if (this.isShuttingDown && this.monitoredPools.size > 0) {
      this.isShuttingDown = false;
    }

    // For pool monitoring, we track pool addresses (not program addresses)
    // Add all monitored pool addresses to the streamer (excluding keep-alive if already added)
    const poolsToAdd: string[] = [];
    
    for (const poolAddress of this.monitoredPools) {
      // Skip keep-alive address if streamer is already running (it's already added)
      if (poolAddress === KEEP_ALIVE_ADDRESS && this.streamerService.getIsStreaming()) {
        continue;
      }
      poolsToAdd.push(poolAddress);
    }

    // If streamer is already running, just add new addresses
    if (this.streamerService.getIsStreaming()) {
      if (poolsToAdd.length > 0) {
        this.streamerService.addAddresses(poolsToAdd);
        console.log(`➕ Added ${poolsToAdd.length} pool address(es) to running streamer`);
      }
    } else {
      // Streamer is not running - add all addresses and start from slot
      if (poolsToAdd.length > 0) {
        this.streamerService.addAddresses(poolsToAdd);
        console.log(`➕ Added ${poolsToAdd.length} pool address(es) to streamer`);
      }
      
      // Start streamer from the given slot (if available)
      this.startStreamerIfNeeded();
    }
  }


  async startMonitoring(
    walletAddress: string,
    tokenAddress: string,
    poolAddress: string,
    maxDuration: number,
    initialPriceData?: { priceUsd: number; priceSol: number; marketCap: number },
    createdAt?: string | null,
    fromSlot?: string | null,
    firstBuyTxId?: string | null
  ): Promise<string> {
    // Use createdAt timestamp if available, otherwise use current time
    // createdAt is in ISO format: "2025-11-23T06:44:25.792Z"
    const startTimestamp = createdAt ? new Date(createdAt).getTime() : Date.now();
    const startTimestampISO = createdAt || new Date(startTimestamp).toISOString();
    
    // Use a unique session key that includes timestamp
    const sessionKey = `${walletAddress}-${tokenAddress}-${startTimestamp}`;

    // Check if already monitoring this exact session
    if (this.sessions.has(sessionKey)) {
      console.log(`⚠️ Already monitoring ${sessionKey}`);
      return sessionKey;
    }

    const session: MonitoringSession = {
      walletAddress,
      tokenAddress,
      poolAddress,
      startTime: startTimestamp,
      maxDuration,
      stopSignal: false,
      timeseriesData: [], // Initialize empty array for timeseries data
      timeoutId: null,
      stopAfterSellTimeout: null,
      processedSignatures: new Set<string>(),
      firstBuyTxId: firstBuyTxId || null,
      firstSellTxId: null
    };

    // Add initial price data to timeseries if available
    if (initialPriceData) {
      session.timeseriesData.push({
        timestamp: startTimestampISO,
        marketcap: initialPriceData.marketCap || null,
        tokenPriceSol: initialPriceData.priceSol || null,
        tokenPriceUsd: initialPriceData.priceUsd || null,
        poolAddress: poolAddress || null,
        sessionKey: sessionKey || null,
        signature: firstBuyTxId || null, // Use first buy transaction ID if available
        transactionType: 'BUY' // Initial data is from first buy transaction
      });
    }

    this.sessions.set(sessionKey, session);

    // Add pool to monitored pools if not already there
    const isNewPool = !this.monitoredPools.has(poolAddress);
    if (isNewPool) {
      this.monitoredPools.add(poolAddress);
      console.log(`➕ Added pool ${poolAddress.substring(0, 8)}... to monitoring (total: ${this.monitoredPools.size})`);
    }

    // // Set fromSlot for first buy recovery (only if this is the first session with fromSlot)
    // if (fromSlot && !this.fromSlot) {
    //   const slotNumber = typeof fromSlot === 'string' ? parseInt(fromSlot, 10) : fromSlot;
    //   if (!isNaN(slotNumber)) {
    //     this.fromSlot = slotNumber;
    //     console.log(`📍 Set fromSlot to ${slotNumber} for first buy recovery`);
        
    //     // Configure streamer with fromSlot
    //     if (this.streamerService) {
    //       this.streamerService.enableAutoReconnect(false); // Disable auto-reconnect when using fromSlot
    //       this.streamerService.setFromSlot(slotNumber);
    //     }
    //   }
    // }

    // Track which sessions are monitoring this pool
    if (!this.poolToSessions.has(poolAddress)) {
      this.poolToSessions.set(poolAddress, new Set());
    }
    this.poolToSessions.get(poolAddress)!.add(sessionKey);

    // Pool is now being monitored (updates will come from streamer)
    // Start streamer if needed and add pool address to streamer
    this.updateStreamerAddresses();

    // Set timeout for maximum duration
    session.timeoutId = setTimeout(() => {
      this.stopMonitoring(sessionKey, false);
    }, maxDuration * 1000);

    const activeSessionsCount = Array.from(this.sessions.values()).filter(s => !s.stopSignal).length;
    console.log(`🔍 Started monitoring token ${tokenAddress.substring(0, 8)}... for wallet ${walletAddress.substring(0, 8)}... (max ${maxDuration}s) [Active sessions: ${activeSessionsCount}]`);

    return sessionKey;
  }

  signalSell(sessionKey: string, sellPriceData?: { priceUsd: number; priceSol: number; marketCap: number }, createdAt?: string | null, firstSellTxId?: string | null): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      this.handleSellSignal(sessionKey, session, sellPriceData, createdAt);
      return;
    }

    // Find most recent active session for this wallet-token pair
    let mostRecentSession: { sessionKey: string; session: MonitoringSession } | null = null;
    for (const [key, sess] of this.sessions.entries()) {
      const walletTokenPrefix = `${sess.walletAddress}-${sess.tokenAddress}`;
      if (key === sessionKey || key.startsWith(sessionKey + '-') || sessionKey.startsWith(walletTokenPrefix)) {
        if (!sess.stopSignal) {
          if (!mostRecentSession || sess.startTime > mostRecentSession.session.startTime) {
            mostRecentSession = { sessionKey: key, session: sess };
          }
        }
      }
    }
    
    if (mostRecentSession) {
      this.handleSellSignal(mostRecentSession.sessionKey, mostRecentSession.session, sellPriceData, createdAt, firstSellTxId);
      return;
    }
    
    console.log(`⚠️ No active monitoring session found for ${sessionKey}`);
  }

  private handleSellSignal(sessionKey: string, session: MonitoringSession, sellPriceData?: { priceUsd: number; priceSol: number; marketCap: number }, createdAt?: string | null, firstSellTxId?: string | null): void {
    console.log(`🛑 Sell signal received for ${session.walletAddress.substring(0, 8)}...-${session.tokenAddress.substring(0, 8)}..., stopping in 10 seconds...`);
    
    // Clear the maxDuration timeout so it doesn't interfere
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = null;
    }
    
    // Set stop signal
    session.stopSignal = true;
    
    // Store first sell transaction ID if provided
    if (firstSellTxId && !session.firstSellTxId) {
      session.firstSellTxId = firstSellTxId;
      console.log(`📝 Stored first sell transaction ID: ${firstSellTxId.substring(0, 8)}...`);
    }
    
    // Use createdAt timestamp if available, otherwise fallback to current time
    // createdAt is in ISO format: "2025-11-23T06:44:25.792Z"
    const sellTimestamp = createdAt ? new Date(createdAt).getTime() : Date.now();
    
    // Add sell transaction to timeseries data if sellPriceData is provided
    if (sellPriceData) {
      const sellTimestampISO = createdAt || new Date(sellTimestamp).toISOString();
      session.timeseriesData.push({
        timestamp: sellTimestampISO,
        marketcap: sellPriceData.marketCap || null,
        tokenPriceSol: sellPriceData.priceSol || null,
        tokenPriceUsd: sellPriceData.priceUsd || null,
        poolAddress: session.poolAddress || null,
        sessionKey: sessionKey || null,
        signature: firstSellTxId || null,
        transactionType: 'SELL'
      });
      console.log(`📈 Added sell transaction to timeseries: $${sellPriceData.priceUsd.toFixed(6)} (MCap: $${sellPriceData.marketCap.toFixed(2)})`);
    } else {
      // If no sellPriceData, try to get latest price from timeseries
      const latestDataPoint = session.timeseriesData.length > 0 
        ? session.timeseriesData[session.timeseriesData.length - 1]
        : null;
      
      if (latestDataPoint && latestDataPoint.tokenPriceUsd) {
        const sellTimestampISO = createdAt || new Date(sellTimestamp).toISOString();
        session.timeseriesData.push({
          timestamp: sellTimestampISO,
          marketcap: latestDataPoint.marketcap,
          tokenPriceSol: latestDataPoint.tokenPriceSol,
          tokenPriceUsd: latestDataPoint.tokenPriceUsd,
          poolAddress: session.poolAddress || null,
          sessionKey: sessionKey || null,
          signature: firstSellTxId || null,
          transactionType: 'SELL'
        });
        console.log(`📈 Added sell transaction to timeseries (using latest price): $${latestDataPoint.tokenPriceUsd.toFixed(6)}`);
      }
    }
    
    // Set timeout to stop monitoring after 10 seconds
    session.stopAfterSellTimeout = setTimeout(() => {
      this.stopMonitoring(sessionKey, true);
    }, 10000);
  }

  async stopMonitoring(sessionKey: string, isAfterSell: boolean): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return;
    }

    const poolAddress = session.poolAddress;

    // Clear timeouts
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }
    if (session.stopAfterSellTimeout) {
      clearTimeout(session.stopAfterSellTimeout);
    }

    // Remove session from pool tracking
    const poolSessions = this.poolToSessions.get(poolAddress);
    if (poolSessions) {
      poolSessions.delete(sessionKey);
      
      // Check if there are any remaining active sessions for this pool
      // First, clean up any stale session references
      Array.from(poolSessions).forEach(key => {
        if (!this.sessions.has(key)) {
          poolSessions.delete(key);
        }
      });
      
      let hasActiveSessions = false;
      for (const remainingSessionKey of poolSessions) {
        const remainingSession = this.sessions.get(remainingSessionKey);
        if (remainingSession && !remainingSession.stopSignal) {
          hasActiveSessions = true;
          break;
        }
      }
      
      // If no active sessions remain for this pool, remove it from monitoring
      // But never remove the keep-alive address
      if (poolSessions.size === 0 || !hasActiveSessions) {
        this.poolToSessions.delete(poolAddress);
        // Remove pool from monitored set and streamer (but not keep-alive address)
        if (poolAddress !== KEEP_ALIVE_ADDRESS) {
          const wasRemoved = this.monitoredPools.delete(poolAddress);
          if (wasRemoved) {
            // Remove pool address from streamer
            if (this.streamerService) {
              this.streamerService.removeAddresses([poolAddress]);
            }
            console.log(`➖ Removed pool ${poolAddress.substring(0, 8)}... from monitoring (no active sessions, remaining pools: ${this.monitoredPools.size})`);
            
            // Update streamer addresses (keep-alive ensures connection stays alive)
            this.updateStreamerAddresses();
          }
        } else {
          console.log(`🔗 Keep-alive address ${poolAddress.substring(0, 8)}... remains active to maintain connection`);
        }
      } else {
        console.log(`ℹ️ Pool ${poolAddress.substring(0, 8)}... still has ${poolSessions.size} active session(s)`);
      }
    }

    // Save peak prices to database (always save, whether after sell or timeout)
    // Peak prices are calculated from timeseries data in savePeakPrices
    await this.savePeakPrices(session);

    // Save all accumulated timeseries data to database
    if (session.timeseriesData.length > 0) {
      console.log(`💾 Saving ${session.timeseriesData.length} timeseries data points to database...`);
      await this.saveTimeseriesData(session);
    } else {
      console.log(`ℹ️ No timeseries data to save for ${sessionKey}`);
    }

    this.sessions.delete(sessionKey);
    console.log(`✅ Stopped monitoring ${sessionKey}`);
  }

  /**
   * Calculate peak prices and buy counts from timeseries data
   */
  private calculatePeakPricesFromTimeseries(
    session: MonitoringSession
  ): { peakBuyToSell: PeakData | null; peakSellToEnd: PeakData | null; buyCount: number; buysBeforeFirstSell: number; buysAfterFirstSell: number } {
    if (!session.firstBuyTxId || session.timeseriesData.length === 0) {
      return {
        peakBuyToSell: null,
        peakSellToEnd: null,
        buyCount: 0,
        buysBeforeFirstSell: 0,
        buysAfterFirstSell: 0
      };
    }

    // Find first buy timestamp from timeseries data
    const firstBuyDataPoint = session.timeseriesData.find(
      dp => dp.signature === session.firstBuyTxId
    );
    
    let firstBuyTimestamp: number;
    
    if (!firstBuyDataPoint || !firstBuyDataPoint.timestamp) {
      // If first buy not found in timeseries, use session start time
      firstBuyTimestamp = session.startTime;
    } else {
      firstBuyTimestamp = new Date(firstBuyDataPoint.timestamp).getTime();
    }
    
    // Filter out transactions before or at first buy based on timestamp
    // Only include events AFTER the wallet's buy timestamp
    const filteredData = session.timeseriesData.filter(dp => {
      if (!dp.timestamp) return false;
      const dpTimestamp = new Date(dp.timestamp).getTime();
      // Only include events strictly after the wallet's buy timestamp
      return dpTimestamp > firstBuyTimestamp;
    });

    // Find first sell data point from all timeseries data (not filtered)
    const firstSellDataPoint = session.firstSellTxId 
      ? session.timeseriesData.find(dp => dp.signature === session.firstSellTxId)
      : null;

    return this.calculatePeaksFromFilteredData(
      filteredData, 
      session.firstSellTxId, 
      firstBuyTimestamp, 
      session.firstBuyTxId,
      firstBuyDataPoint,
      firstSellDataPoint
    );
  }

  /**
   * Calculate peaks from filtered timeseries data
   */
  private calculatePeaksFromFilteredData(
    filteredData: TimeseriesDataPoint[],
    firstSellTxId: string | null,
    firstBuyTimestamp: number,
    firstBuyTxId: string | null,
    firstBuyDataPoint: TimeseriesDataPoint | undefined,
    firstSellDataPoint: TimeseriesDataPoint | undefined
  ): { peakBuyToSell: PeakData | null; peakSellToEnd: PeakData | null; buyCount: number; buysBeforeFirstSell: number; buysAfterFirstSell: number } {
    // Initialize peakBuyToSell with buy data if available (even if filteredData is empty)
    let peakBuyToSell: PeakData | null = null;
    if (firstBuyDataPoint) {
      const buyTimestamp = firstBuyDataPoint.timestamp ? new Date(firstBuyDataPoint.timestamp).getTime() : firstBuyTimestamp;
      const buyPriceUsd = firstBuyDataPoint.tokenPriceUsd || 0;
      const buyPriceSol = firstBuyDataPoint.tokenPriceSol || 0;
      const buyMarketCap = firstBuyDataPoint.marketcap || 0;
      
      // Initialize with buy data if we have valid price or market cap
      if (buyPriceUsd > 0 || buyMarketCap > 0) {
        peakBuyToSell = {
          peakPriceSol: buyPriceSol,
          peakPriceUsd: buyPriceUsd,
          peakMarketCap: buyMarketCap,
          timestamp: buyTimestamp
        };
      }
    }
    
    if (filteredData.length === 0) {
      return { peakBuyToSell, peakSellToEnd: null, buyCount: 0, buysBeforeFirstSell: 0, buysAfterFirstSell: 0 };
    }

    // Remove duplicates by signature (keep first occurrence)
    const seenSignatures = new Set<string>();
    const deduplicatedData = filteredData.filter(dp => {
      // Filter out transactions before or at first buy timestamp
      // Only include events strictly after the wallet's buy timestamp
      if (dp.timestamp) {
        const dpTimestamp = new Date(dp.timestamp).getTime();
        if (dpTimestamp <= firstBuyTimestamp) {
          return false; // Ignore data before or at buy transaction
        }
      }
      
      // Filter out duplicates by signature
      if (dp.signature) {
        if (seenSignatures.has(dp.signature)) {
          return false; // Skip duplicate
        }
        seenSignatures.add(dp.signature);
      }
      
      return true;
    });
    
    // peakBuyToSell is already initialized with buy data above
    let peakSellToEnd: PeakData | null = null;
    let buyCount = 0;
    let buysBeforeFirstSell = 0;
    let buysAfterFirstSell = 0;
    let sellTimestamp: number | null = null;
    const TEN_SECONDS_MS = 10 * 1000; // 10 seconds in milliseconds

    // Find sell timestamp if firstSellTxId is provided
    if (firstSellTxId) {
      const sellDataPoint = deduplicatedData.find(dp => dp.signature === firstSellTxId);
      if (sellDataPoint && sellDataPoint.timestamp) {
        sellTimestamp = new Date(sellDataPoint.timestamp).getTime();
      }
    }

    // Process each deduplicated data point
    for (const dp of deduplicatedData) {
      if (!dp.timestamp || !dp.tokenPriceUsd) continue;

      const dpTimestamp = new Date(dp.timestamp).getTime();
      
      // Skip if timestamp is before or at first buy (additional safety check)
      // Only process events strictly after the wallet's buy timestamp
      if (dpTimestamp <= firstBuyTimestamp) {
        continue;
      }
      
      const priceUsd = dp.tokenPriceUsd;
      const priceSol = dp.tokenPriceSol || 0;
      const marketCap = dp.marketcap || 0;

      // Count buy transactions (only BUY type transactions with signature)
      // Exclude the first buy transaction itself from the count (already filtered by timestamp, but double-check)
      // All data here should already be after the wallet's buy, so we just need to check it's not the wallet's buy signature
      if (dp.signature && dp.transactionType === 'BUY' && dp.signature !== firstBuyTxId) {
        buyCount++;
        
        // Count buys before first sell (strictly before sell timestamp)
        if (!sellTimestamp || dpTimestamp < sellTimestamp) {
          buysBeforeFirstSell++;
        } else if (sellTimestamp && dpTimestamp >= sellTimestamp && dpTimestamp <= sellTimestamp + TEN_SECONDS_MS) {
          // Count buys after first sell (within 10 seconds)
          buysAfterFirstSell++;
        }
      }

      // Calculate peakBuyToSell (before sell)
      // Note: All data here is already after the wallet's buy timestamp (filtered above)
      // Update peakBuyToSell if we find a higher price than the initial buy data
      if (!sellTimestamp || dpTimestamp < sellTimestamp) {
        if (peakBuyToSell) {
          // Update if we find a higher price
          if (priceUsd > peakBuyToSell.peakPriceUsd) {
            peakBuyToSell = {
              peakPriceSol: priceSol,
              peakPriceUsd: priceUsd,
              peakMarketCap: marketCap,
              timestamp: dpTimestamp
            };
          }
        } else {
          // Initialize if not already set (shouldn't happen, but safety check)
          peakBuyToSell = {
            peakPriceSol: priceSol,
            peakPriceUsd: priceUsd,
            peakMarketCap: marketCap,
            timestamp: dpTimestamp
          };
        }
      } else {
        // Calculate peakSellToEnd (after sell)
        if (!peakSellToEnd || priceUsd > peakSellToEnd.peakPriceUsd) {
          peakSellToEnd = {
            peakPriceSol: priceSol,
            peakPriceUsd: priceUsd,
            peakMarketCap: marketCap,
            timestamp: dpTimestamp
          };
        }
      }
    }

    // Fallback: If peakBuyToSell is still null (shouldn't happen if firstBuyDataPoint exists, but safety check)
    // Use first buy data point to initialize
    if (!peakBuyToSell && firstBuyDataPoint) {
      const buyTimestamp = firstBuyDataPoint.timestamp ? new Date(firstBuyDataPoint.timestamp).getTime() : firstBuyTimestamp;
      const buyPriceUsd = firstBuyDataPoint.tokenPriceUsd || 0;
      const buyPriceSol = firstBuyDataPoint.tokenPriceSol || 0;
      const buyMarketCap = firstBuyDataPoint.marketcap || 0;
      
      // Initialize even if market cap is 0, as long as we have price data
      if (buyPriceUsd > 0 || buyMarketCap > 0) {
        peakBuyToSell = {
          peakPriceSol: buyPriceSol,
          peakPriceUsd: buyPriceUsd,
          peakMarketCap: buyMarketCap,
          timestamp: buyTimestamp
        };
      }
    }

    // Fallback: If no buys after first sell, use first sell market cap for peakSellToEnd
    if (!peakSellToEnd && buysAfterFirstSell === 0 && firstSellDataPoint) {
      const sellTimestamp = firstSellDataPoint.timestamp ? new Date(firstSellDataPoint.timestamp).getTime() : 0;
      const sellPriceUsd = firstSellDataPoint.tokenPriceUsd || 0;
      const sellPriceSol = firstSellDataPoint.tokenPriceSol || 0;
      const sellMarketCap = firstSellDataPoint.marketcap || 0;
      
      if (sellMarketCap > 0) {
        peakSellToEnd = {
          peakPriceSol: sellPriceSol,
          peakPriceUsd: sellPriceUsd,
          peakMarketCap: sellMarketCap,
          timestamp: sellTimestamp
        };
      }
    }

    return { peakBuyToSell, peakSellToEnd, buyCount, buysBeforeFirstSell, buysAfterFirstSell };
  }

  async savePeakPrices(session: MonitoringSession): Promise<void> {
    try {
      // Calculate peak prices from timeseries data
      const calculated = this.calculatePeakPricesFromTimeseries(session);
      
      // If peakBuyToSell is still null, try to initialize with buy data from timeseries
      let peakBuyToSell = calculated.peakBuyToSell;
      if (!peakBuyToSell && session.timeseriesData.length > 0) {
        // Try to find first buy data point
        let firstBuyDataPoint: TimeseriesDataPoint | undefined;
        
        if (session.firstBuyTxId) {
          // Look for the first buy transaction by signature
          firstBuyDataPoint = session.timeseriesData.find(
            dp => dp.signature === session.firstBuyTxId
          );
        }
        
        // If not found by signature, look for first BUY transaction type
        if (!firstBuyDataPoint) {
          firstBuyDataPoint = session.timeseriesData.find(
            dp => dp.transactionType === 'BUY'
          );
        }
        
        // If still not found, use first data point with valid price
        if (!firstBuyDataPoint) {
          firstBuyDataPoint = session.timeseriesData.find(
            dp => dp.tokenPriceUsd && dp.tokenPriceUsd > 0
          );
        }
        
        // Initialize peakBuyToSell with found data point
        if (firstBuyDataPoint) {
          const buyTimestamp = firstBuyDataPoint.timestamp 
            ? new Date(firstBuyDataPoint.timestamp).getTime() 
            : session.startTime;
          const buyPriceUsd = firstBuyDataPoint.tokenPriceUsd || 0;
          const buyPriceSol = firstBuyDataPoint.tokenPriceSol || 0;
          const buyMarketCap = firstBuyDataPoint.marketcap || 0;
          
          if (buyPriceUsd > 0 || buyMarketCap > 0) {
            peakBuyToSell = {
              peakPriceSol: buyPriceSol,
              peakPriceUsd: buyPriceUsd,
              peakMarketCap: buyMarketCap,
              timestamp: buyTimestamp
            };
            console.log(`📊 Initialized peakBuyToSell with buy data: $${buyPriceUsd.toFixed(6)} (MCap: $${buyMarketCap.toFixed(2)})`);
          }
        }
      }
      
      // Final fallback: use zeros if still null
      peakBuyToSell = peakBuyToSell || {
        peakPriceSol: 0,
        peakPriceUsd: 0,
        peakMarketCap: 0,
        timestamp: 0
      };

      const peakSellToEnd = calculated.peakSellToEnd || {
        peakPriceSol: 0,
        peakPriceUsd: 0,
        peakMarketCap: 0,
        timestamp: 0
      };

      const buyCount = calculated.buyCount;
      const buysBeforeFirstSell = calculated.buysBeforeFirstSell;
      const buysAfterFirstSell = calculated.buysAfterFirstSell;

      console.log(`💾 Saving peak prices (calculated from ${session.timeseriesData.length} timeseries points):`);
      console.log(`   Buy to Sell: Price SOL=${peakBuyToSell.peakPriceSol}, Price USD=${peakBuyToSell.peakPriceUsd}, MCap=${peakBuyToSell.peakMarketCap}`);
      console.log(`   Sell to End: Price SOL=${peakSellToEnd.peakPriceSol}, Price USD=${peakSellToEnd.peakPriceUsd}, MCap=${peakSellToEnd.peakMarketCap}`);
      console.log(`   Total Buy Count: ${buyCount}`);
      console.log(`   Buys Before First Sell: ${buysBeforeFirstSell}`);
      console.log(`   Buys After First Sell (within 10s): ${buysAfterFirstSell}`);

      await dbService.updateWalletPeakPrices(
        session.walletAddress,
        session.tokenAddress,
        peakBuyToSell.peakPriceSol,
        peakBuyToSell.peakPriceUsd,
        peakBuyToSell.peakMarketCap,
        peakSellToEnd.peakPriceSol,
        peakSellToEnd.peakPriceUsd,
        peakSellToEnd.peakMarketCap,
        buysBeforeFirstSell,
        buysAfterFirstSell
      );

      console.log(`💾 Saved peak prices for ${session.walletAddress.substring(0, 8)}... - ${session.tokenAddress.substring(0, 8)}...`);
    } catch (error) {
      console.error('Failed to save peak prices:', error);
    }
  }

  async saveTimeseriesData(session: MonitoringSession): Promise<void> {
    try {
      if (session.timeseriesData.length === 0) {
        return;
      }

      // Get first buy timestamp to filter out events before wallet's buy
      let firstBuyTimestamp: number = session.startTime;
      if (session.firstBuyTxId) {
        const firstBuyDataPoint = session.timeseriesData.find(
          dp => dp.signature === session.firstBuyTxId
        );
        if (firstBuyDataPoint && firstBuyDataPoint.timestamp) {
          firstBuyTimestamp = new Date(firstBuyDataPoint.timestamp).getTime();
        }
      }

      // Deduplicate timeseries data by signature (keep first occurrence)
      // Also filter out events before or at the wallet's buy timestamp
      const seenSignatures = new Set<string>();
      const deduplicatedData = session.timeseriesData.filter(dp => {
        // Filter out events before or at the wallet's buy timestamp
        if (dp.timestamp) {
          const dpTimestamp = new Date(dp.timestamp).getTime();
          if (dpTimestamp <= firstBuyTimestamp) {
            return false; // Exclude events before or at wallet's buy
          }
        }
        
        // If no signature, include it (might be initial data point, but already filtered by timestamp above)
        if (!dp.signature) {
          return true;
        }
        
        // If signature already seen, skip it
        if (seenSignatures.has(dp.signature)) {
          return false;
        }
        
        // Mark signature as seen and include this data point
        seenSignatures.add(dp.signature);
        return true;
      });

      const duplicatesRemoved = session.timeseriesData.length - deduplicatedData.length;
      if (duplicatesRemoved > 0) {
        console.log(`🔍 Removed ${duplicatesRemoved} duplicate timeseries data points (based on signature)`);
      }

      // Save deduplicated timeseries data points to the database
      await dbService.savePoolPriceTimeseriesBatch(
        session.walletAddress,
        session.tokenAddress,
        deduplicatedData
      );

      console.log(`💾 Saved ${deduplicatedData.length} timeseries data points for ${session.walletAddress.substring(0, 8)}... - ${session.tokenAddress.substring(0, 8)}...`);
    } catch (error) {
      console.error('Failed to save timeseries data:', error);
    }
  }

  isMonitoring(walletAddress: string, tokenAddress: string): boolean {
    for (const [key, sess] of this.sessions.entries()) {
      if (sess.walletAddress === walletAddress && 
          sess.tokenAddress === tokenAddress && 
          !sess.stopSignal) {
        return true;
      }
    }
    return false;
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up pool monitoring service...');
    
    // Set shutdown flag first
    this.isShuttingDown = true;
    
    // Stop the streamer
    this.stopStreamer();
    
    // Clear all sessions and pools (including keep-alive address during cleanup)
    this.sessions.clear();
    this.poolToSessions.clear();
    this.monitoredPools.clear();
    
    console.log('✅ Pool monitoring service cleaned up');
  }
}

// Singleton instance
let poolMonitor: LiquidityPoolMonitor | null = null;

export class PoolMonitoringService {
  private static instance: PoolMonitoringService | null = null;
  private monitor: LiquidityPoolMonitor | null = null;

  private constructor() {}

  static async getInstance(solanaConnection: Connection): Promise<PoolMonitoringService> {
    if (!PoolMonitoringService.instance) {
      PoolMonitoringService.instance = new PoolMonitoringService();
      
      // Create pool monitor (uses streaming)
      poolMonitor = new LiquidityPoolMonitor(solanaConnection);
      PoolMonitoringService.instance.monitor = poolMonitor;
      
      console.log('✅ Pool monitoring service initialized (using streaming)');
    }

    return PoolMonitoringService.instance;
  }

  async startMonitoring(
    walletAddress: string,
    tokenAddress: string,
    poolAddress: string,
    maxDuration: number = 3600, // Default 1 hour
    initialPriceData?: { priceUsd: number; priceSol: number; marketCap: number },
    createdAt?: string | null,
    fromSlot?: string | null,
    firstBuyTxId?: string | null
  ): Promise<string> {
    if (!this.monitor) {
      throw new Error('Pool monitor not initialized');
    }

    return this.monitor.startMonitoring(walletAddress, tokenAddress, poolAddress, maxDuration, initialPriceData, createdAt, fromSlot, firstBuyTxId);
  }

  signalSell(walletAddress: string, tokenAddress: string, sellPriceData?: { priceUsd: number; priceSol: number; marketCap: number }, createdAt?: string | null, firstSellTxId?: string | null): void {
    if (!this.monitor) {
      return;
    }

    const sessionKey = `${walletAddress}-${tokenAddress}`;
    this.monitor.signalSell(sessionKey, sellPriceData, createdAt, firstSellTxId);
  }

  isMonitoring(walletAddress: string, tokenAddress: string): boolean {
    if (!this.monitor) {
      return false;
    }

    return this.monitor.isMonitoring(walletAddress, tokenAddress);
  }

  async cleanup(): Promise<void> {
    if (this.monitor) {
      await this.monitor.cleanup();
    }
  }
}
