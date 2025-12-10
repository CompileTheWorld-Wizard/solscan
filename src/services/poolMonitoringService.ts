/**
 * Pool Monitoring Service
 * Monitors pool transactions using ladybug streaming
 * Tracks price and market cap changes and calculates peak values
 */

import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { dbService } from '../database';
import { redisService } from './redisService';
import { Parser, TransactionStreamer } from "@shyft-to/ladybug-sdk";
import { Idl } from "@coral-xyz/anchor";
import { Idl as SerumIdl } from "@project-serum/anchor";
import { convertLadybugEventToTrackerFormat } from './ladybugEventConverter';
import { LadybugEvent, LadybugTransaction } from './ladybugTypes';
import pumpIdl from "./idls/pumpfun/pump_0.1.0.json";
import pumpAmmIdl from "./idls/pumpAmm/pump_amm_0.1.0.json";
import * as fs from 'fs';
import * as path from 'path';
import { isObject } from "lodash";

const PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

// const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

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

function bnLayoutFormatter(obj: any) {
  for (const key in obj) {
    if (obj[key]?.constructor?.name === "PublicKey") {
      obj[key] = (obj[key] as PublicKey).toBase58();
    } else if (obj[key]?.constructor?.name === "BN") {
      obj[key] = Number(obj[key].toString());
    } else if (obj[key]?.constructor?.name === "BigInt") {
      obj[key] = Number(obj[key].toString());
    } else if (obj[key]?.constructor?.name === "Buffer") {
      obj[key] = (obj[key] as Buffer).toString("base64");
    } else if (isObject(obj[key])) {
      bnLayoutFormatter(obj[key]);
    } else {
      obj[key] = obj[key];
    }
  }
}

class LiquidityPoolMonitor {
  accountCoder: BorshAccountsCoder;
  solanaConnection: Connection;
  sessions: Map<string, MonitoringSession>; // Key: walletAddress-tokenAddress-timestamp
  tokenToSessions: Map<string, Set<string>>; // Key: tokenAddress, Value: Set of sessionKeys
  monitoredTokens: Set<string>; // Track which tokens we're monitoring
  private parser: Parser;
  private streamer: TransactionStreamer | null = null;
  private isStreaming: boolean = false;
  private grpcUrl: string;
  private xToken: string;
  private lastSlot: number | null = null; // Track last processed slot for reconnection
  private fromSlot: number | null = null; // Slot to start from (for first buy recovery)

  constructor(solanaConnection: Connection) {
    this.solanaConnection = solanaConnection;
    this.sessions = new Map();
    this.tokenToSessions = new Map();
    this.monitoredTokens = new Set();

    // Get gRPC credentials from environment
    if (!process.env.GRPC_URL || !process.env.X_TOKEN) {
      throw new Error("Missing GRPC_URL or X_TOKEN environment variables for pool monitoring");
    }
    this.grpcUrl = process.env.GRPC_URL;
    this.xToken = process.env.X_TOKEN;

    // Initialize ladybug parser
    this.parser = new Parser();
    this.initializeParser();

    // Initialize ladybug streamer
    this.initializeStreamer();

    // Load IDL files for account decoding
    const pumpFunIdlPath = path.join(__dirname, '../parsers/pumpFun/idls/pump_0.1.0.json');
    const pumpAmmIdlPath = path.join(__dirname, '../parsers/pumpAmm/idls/pump_amm_0.1.0.json');

    let programIdl;
    try {
      // Try pump AMM first, fallback to pump.fun
      if (fs.existsSync(pumpAmmIdlPath)) {
        programIdl = JSON.parse(fs.readFileSync(pumpAmmIdlPath, 'utf8'));
      } else if (fs.existsSync(pumpFunIdlPath)) {
        programIdl = JSON.parse(fs.readFileSync(pumpFunIdlPath, 'utf8'));
      } else {
        throw new Error('IDL files not found');
      }
      this.accountCoder = new BorshAccountsCoder(programIdl);
    } catch (error) {
      console.error('Failed to load IDL files:', error);
      throw error;
    }
  }

  /**
   * Initialize parser with IDL files
   */
  private initializeParser(): void {
    try {
      this.parser.addIDL(new PublicKey(PUMP_FUN_PROGRAM_ID), pumpIdl as Idl);
      this.parser.addIDL(new PublicKey(PUMP_AMM_PROGRAM_ID), pumpAmmIdl as Idl);
    } catch (error) {
      console.error(`❌ Error loading IDL files:`, error);
    }
  }

  /**
   * Initialize the ladybug streamer
   */
  private initializeStreamer(): void {
    try {
      this.streamer = new TransactionStreamer(this.grpcUrl, this.xToken);
      this.streamer.addParser(this.parser);
      
      // Set up callback for ladybug events
      this.streamer.onData((tx: LadybugTransaction) => {
        this.handleLadybugTransaction(tx);
      });
      
      // Set up error callback for manual reconnection
      this.streamer.onError((error: any) => {
        console.error('❌ Pool monitoring streamer error:', error);
        this.handleStreamerError(error);
      });
      
      // Add PumpFun and PumpAmm program addresses to track
      this.streamer.addAddresses([
        PUMP_FUN_PROGRAM_ID,
        PUMP_AMM_PROGRAM_ID
      ]);
      
      console.log("✅ Pool monitoring ladybug streamer initialized");
    } catch (error: any) {
      console.error('Failed to initialize pool monitoring ladybug streamer:', error?.message || error);
    }
  }

  /**
   * Handle streamer errors and reconnect from lastSlot
   */
  private handleStreamerError(error: any): void {
    if (!this.streamer) {
      return;
    }

    // If we have a lastSlot, reconnect from there
    if (this.lastSlot !== null) {
      console.log(`🔄 Reconnecting pool monitoring streamer from last slot: ${this.lastSlot}`);
      this.reconnectFromSlot(this.lastSlot);
    } else if (this.fromSlot !== null) {
      // Fallback to fromSlot if lastSlot is not available
      console.log(`🔄 Reconnecting pool monitoring streamer from fromSlot: ${this.fromSlot}`);
      this.reconnectFromSlot(this.fromSlot);
    } else {
      console.error('❌ No slot available for reconnection');
    }
  }

  /**
   * Reconnect streamer from a specific slot
   */
  private reconnectFromSlot(slot: number): void {
    if (!this.streamer) {
      return;
    }

    try {
      // Stop current stream
      if (this.isStreaming) {
        this.streamer.stop();
        this.isStreaming = false;
      }

      // Disable auto-reconnect when using fromSlot
      this.streamer.enableAutoReconnect(false);
      
      // Set fromSlot
      this.streamer.setFromSlot(slot);
      
      // Restart streamer
      this.streamer.start();
      this.isStreaming = true;
      
      console.log(`✅ Reconnected pool monitoring streamer from slot ${slot}`);
    } catch (error: any) {
      console.error(`Failed to reconnect from slot ${slot}:`, error?.message || error);
    }
  }

  /**
   * Handle transactions from ladybug streamer
   */
  private handleLadybugTransaction(tx: LadybugTransaction): void {
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
        const result = convertLadybugEventToTrackerFormat(
          event as LadybugEvent,
          signature,
          slot,
          createdAt
        );

        if (!result || !result.price) {
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

        // Only process if this token is being monitored
        if (!this.monitoredTokens.has(tokenAddress)) {
          continue;
        }

        // Process the pool update
        this.handlePoolUpdate(result, tokenAddress, signature || null, createdAt || null);
      }
    } catch (error: any) {
      console.error(`❌ Error handling ladybug transaction in pool monitoring:`, error?.message || error);
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

  getAccountName(data: string): string {
    const accountNames = ["BondingCurve", "Global", "Pool"];

    const discriminator = Buffer.from(data, 'base64').slice(0, 8);

    let account;
    accountNames.forEach((accountName) => {
      try {
        const accountDiscriminator = this.accountCoder.accountDiscriminator(accountName);
        if (accountDiscriminator.equals(discriminator)) {
          account = accountName;
        }
      } catch (error) {
        // Skip if discriminator doesn't match
      }
    });

    if (!account) {
      return 'Unknown';
    }

    return account;
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
   * Handle pool updates from ladybug streamer
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

      // First check if this token is still being monitored
      if (!this.monitoredTokens.has(tokenAddress)) {
        // Token was removed from monitoring, ignore this update
        return;
      }

      // Find all sessions monitoring this token
      const sessionKeys = this.tokenToSessions.get(tokenAddress);
      if (!sessionKeys || sessionKeys.size === 0) {
        // No sessions for this token - remove it from monitoring
        this.monitoredTokens.delete(tokenAddress);
        this.tokenToSessions.delete(tokenAddress);
        console.log(`🧹 Cleaned up orphaned token ${tokenAddress.substring(0, 8)}... (no sessions)`);
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
        // If no valid sessions remain, remove token
        if (sessionKeys.size === 0) {
          this.monitoredTokens.delete(tokenAddress);
          this.tokenToSessions.delete(tokenAddress);
          console.log(`🧹 Cleaned up token ${tokenAddress.substring(0, 8)}... (all sessions were stale)`);
          return;
        }
      }

      // Get token price in SOL from parseTransaction result
      const tokenPriceSol = result.price ? parseFloat(result.price.toString()) : null;
      if (tokenPriceSol === null || isNaN(tokenPriceSol)) {
        console.log(`⚠️ No valid price found in transaction result for token ${tokenAddress.substring(0, 8)}...`);
        return;
      }

      // Get pool address from result if available
      const poolAddress = result.pool || null;

      // Get SOL price from Redis to calculate USD price and market cap
      const solPriceUsd = await redisService.getLatestSolPrice();
      if (!solPriceUsd) {
        console.log('⚠️ Failed to fetch SOL price from Redis for pool monitoring');
        return;
      }

      const priceUsd = tokenPriceSol * solPriceUsd;
      
      // Validate priceUsd
      if (!priceUsd || isNaN(priceUsd) || !isFinite(priceUsd) || priceUsd <= 0) {
        console.warn(`⚠️ [MARKETCAP DEBUG] Invalid priceUsd: ${priceUsd} (tokenPriceSol: ${tokenPriceSol}, solPriceUsd: ${solPriceUsd})`);
        return;
      }

      // Calculate market cap once for this token (all sessions share the same token)
      let marketCap = 0;
      try {
        console.log(`🔍 [MARKETCAP DEBUG] Starting marketcap calculation for token ${tokenAddress.substring(0, 8)}...`);
        console.log(`🔍 [MARKETCAP DEBUG] Price USD: ${priceUsd}, Price SOL: ${tokenPriceSol}`);
        
        const mintPublicKey = new PublicKey(tokenAddress);
        console.log(`🔍 [MARKETCAP DEBUG] Fetching token supply for mint: ${tokenAddress}`);
        
        const tokenSupply = await this.solanaConnection.getTokenSupply(mintPublicKey);
        console.log(`🔍 [MARKETCAP DEBUG] Token supply response:`, tokenSupply ? 'exists' : 'null', tokenSupply?.value ? 'has value' : 'no value');
        
        if (tokenSupply && tokenSupply.value) {
          const rawSupply = parseFloat(tokenSupply.value.amount);
          const decimals = tokenSupply.value.decimals;
          console.log(`🔍 [MARKETCAP DEBUG] Raw supply: ${rawSupply}, Decimals: ${decimals}`);
          
          if (isNaN(rawSupply) || !isFinite(rawSupply) || rawSupply <= 0) {
            console.warn(`⚠️ [MARKETCAP DEBUG] Invalid raw supply: ${rawSupply}`);
          } else if (isNaN(decimals) || decimals < 0 || decimals > 18) {
            console.warn(`⚠️ [MARKETCAP DEBUG] Invalid decimals: ${decimals}`);
          } else {
            const totalSupply = rawSupply / Math.pow(10, decimals);
            console.log(`🔍 [MARKETCAP DEBUG] Total supply (after decimals): ${totalSupply}`);
            
            if (totalSupply <= 0 || !isFinite(totalSupply)) {
              console.warn(`⚠️ [MARKETCAP DEBUG] Invalid total supply: ${totalSupply}`);
            } else {
              marketCap = totalSupply * priceUsd;
              console.log(`🔍 [MARKETCAP DEBUG] Calculated marketcap: ${totalSupply} * ${priceUsd} = ${marketCap}`);
              
              if (marketCap === 0 || isNaN(marketCap) || !isFinite(marketCap)) {
                console.warn(`⚠️ [MARKETCAP DEBUG] Invalid marketcap result: ${marketCap} (totalSupply: ${totalSupply}, priceUsd: ${priceUsd})`);
              } else {
                console.log(`✅ [MARKETCAP DEBUG] Successfully calculated marketcap: $${marketCap.toFixed(2)}`);
              }
            }
          }
        } else {
          console.warn(`⚠️ [MARKETCAP DEBUG] Token supply is null or missing value. tokenSupply:`, tokenSupply);
        }
      } catch (error) {
        console.error(`❌ [MARKETCAP DEBUG] Failed to fetch token supply for ${tokenAddress.substring(0, 8)}...:`, error);
        if (error instanceof Error) {
          console.error(`❌ [MARKETCAP DEBUG] Error message: ${error.message}`);
          console.error(`❌ [MARKETCAP DEBUG] Error stack: ${error.stack}`);
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
          console.warn(`⚠️ [MARKETCAP DEBUG] Session token address mismatch: session has ${sessionTokenAddress.substring(0, 8)}..., but update is for ${tokenAddress.substring(0, 8)}...`);
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
        
        if (marketcapValue === null && marketCap === 0) {
          console.warn(`⚠️ [MARKETCAP DEBUG] Storing null marketcap for session ${sessionKey.substring(0, 20)}... (calculation resulted in 0 or failed)`);
        }
        
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
   * Start the ladybug streamer if not already running
   */
  private startStreamerIfNeeded(): void {
    if (!this.streamer) {
      console.warn('⚠️ Streamer not initialized');
      return;
    }

    if (!this.isStreaming) {
      try {
        // If fromSlot is set, ensure auto-reconnect is disabled
        if (this.fromSlot !== null) {
          this.streamer.enableAutoReconnect(false);
          this.streamer.setFromSlot(this.fromSlot);
          console.log(`📍 Starting streamer with fromSlot: ${this.fromSlot}`);
        }
        
        this.streamer.start();
        this.isStreaming = true;
        console.log('✅ Started pool monitoring ladybug streamer');
      } catch (error: any) {
        console.error('Failed to start pool monitoring streamer:', error?.message || error);
      }
    }
  }

  /**
   * Stop the ladybug streamer
   */
  private stopStreamer(): void {
    if (this.streamer && this.isStreaming) {
      try {
        this.streamer.stop();
        this.isStreaming = false;
        console.log('✅ Stopped pool monitoring ladybug streamer');
      } catch (error: any) {
        console.error('Failed to stop pool monitoring streamer:', error?.message || error);
      }
    }
  }

  /**
   * Update streamer addresses when tokens are added/removed
   */
  private updateStreamerAddresses(): void {
    if (!this.streamer) {
      return;
    }

    // For pool monitoring, we track program addresses (PumpFun/PumpAmm)
    // The streamer already has these addresses, so we just need to ensure it's running
    // when we have tokens to monitor
    if (this.monitoredTokens.size > 0) {
      this.startStreamerIfNeeded();
    } else {
      // If no tokens to monitor, we can stop the streamer
      // But keep it running since program addresses are always tracked
      // this.stopStreamer();
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

    // Add token to monitored tokens if not already there
    const isNewToken = !this.monitoredTokens.has(tokenAddress);
    if (isNewToken) {
      this.monitoredTokens.add(tokenAddress);
      console.log(`➕ Added token ${tokenAddress.substring(0, 8)}... to monitoring (total: ${this.monitoredTokens.size})`);
    }

    // Set fromSlot for first buy recovery (only if this is the first session with fromSlot)
    if (fromSlot && !this.fromSlot) {
      const slotNumber = typeof fromSlot === 'string' ? parseInt(fromSlot, 10) : fromSlot;
      if (!isNaN(slotNumber)) {
        this.fromSlot = slotNumber;
        console.log(`📍 Set fromSlot to ${slotNumber} for first buy recovery`);
        
        // Configure streamer with fromSlot
        if (this.streamer) {
          this.streamer.enableAutoReconnect(false); // Disable auto-reconnect when using fromSlot
          this.streamer.setFromSlot(slotNumber);
        }
      }
    }

    // Track which sessions are monitoring this token
    if (!this.tokenToSessions.has(tokenAddress)) {
      this.tokenToSessions.set(tokenAddress, new Set());
    }
    this.tokenToSessions.get(tokenAddress)!.add(sessionKey);

    // Token is now being monitored (updates will come from ladybug streamer)
    // Start streamer if needed
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

    const tokenAddress = session.tokenAddress;

    // Clear timeouts
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }
    if (session.stopAfterSellTimeout) {
      clearTimeout(session.stopAfterSellTimeout);
    }

    // Remove session from token tracking
    const tokenSessions = this.tokenToSessions.get(tokenAddress);
    if (tokenSessions) {
      tokenSessions.delete(sessionKey);
      
      // Check if there are any remaining active sessions for this token
      // First, clean up any stale session references
      Array.from(tokenSessions).forEach(key => {
        if (!this.sessions.has(key)) {
          tokenSessions.delete(key);
        }
      });
      
      let hasActiveSessions = false;
      for (const remainingSessionKey of tokenSessions) {
        const remainingSession = this.sessions.get(remainingSessionKey);
        if (remainingSession && !remainingSession.stopSignal) {
          hasActiveSessions = true;
          break;
        }
      }
      
      // If no active sessions remain for this token, remove it from monitoring
      if (tokenSessions.size === 0 || !hasActiveSessions) {
        this.tokenToSessions.delete(tokenAddress);
        // Remove token from monitored set BEFORE updating subscription
        const wasRemoved = this.monitoredTokens.delete(tokenAddress);
        if (wasRemoved) {
          console.log(`➖ Removed token ${tokenAddress.substring(0, 8)}... from monitoring (no active sessions, remaining tokens: ${this.monitoredTokens.size})`);
          
          // Token removed from monitoring
        }
      } else {
        console.log(`ℹ️ Token ${tokenAddress.substring(0, 8)}... still has ${tokenSessions.size} active session(s)`);
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
    if (filteredData.length === 0) {
      return { peakBuyToSell: null, peakSellToEnd: null, buyCount: 0, buysBeforeFirstSell: 0, buysAfterFirstSell: 0 };
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

    let peakBuyToSell: PeakData | null = null;
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
      if (!sellTimestamp || dpTimestamp < sellTimestamp) {
        if (!peakBuyToSell || priceUsd > peakBuyToSell.peakPriceUsd) {
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

    // Fallback: If no buys before first sell, use first buy market cap for peakBuyToSell
    if (!peakBuyToSell && buysBeforeFirstSell === 0 && firstBuyDataPoint) {
      const buyTimestamp = firstBuyDataPoint.timestamp ? new Date(firstBuyDataPoint.timestamp).getTime() : firstBuyTimestamp;
      const buyPriceUsd = firstBuyDataPoint.tokenPriceUsd || 0;
      const buyPriceSol = firstBuyDataPoint.tokenPriceSol || 0;
      const buyMarketCap = firstBuyDataPoint.marketcap || 0;
      
      if (buyMarketCap > 0) {
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
      
      const peakBuyToSell = calculated.peakBuyToSell || {
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
    
    // Stop the streamer
    this.stopStreamer();
    
    // Clear all sessions and tokens
    this.sessions.clear();
    this.tokenToSessions.clear();
    this.monitoredTokens.clear();
    
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
      
      // Create pool monitor (uses ladybug streaming)
      poolMonitor = new LiquidityPoolMonitor(solanaConnection);
      PoolMonitoringService.instance.monitor = poolMonitor;
      
      console.log('✅ Pool monitoring service initialized (using ladybug streaming)');
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
