/**
 * Pool Monitoring Service
 * Monitors pool accounts using Yellowstone gRPC for pump.fun and pump AMM
 * Tracks price and market cap changes and calculates peak values
 */

import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { SubscribeRequest } from "@triton-one/yellowstone-grpc/dist/types/grpc/geyser";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { dbService } from '../database';
import * as fs from 'fs';
import * as path from 'path';
import { isObject } from "lodash";
import * as bs58 from "bs58";

// const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

interface PeakData {
  peakPriceSol: number;
  peakPriceUsd: number;
  peakMarketCap: number;
  timestamp: number;
}

interface MonitoringSession {
  walletAddress: string;
  tokenAddress: string;
  poolAddress: string;
  startTime: number;
  maxDuration: number; // in seconds
  stopSignal: boolean;
  peakBuyToSell: PeakData | null;
  peakSellToEnd: PeakData | null;
  currentPriceSol: number;
  currentPriceUsd: number;
  currentMarketCap: number;
  timeoutId: NodeJS.Timeout | null;
  stopAfterSellTimeout: NodeJS.Timeout | null;
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
  grpcClient: Client | null;
  accountCoder: BorshAccountsCoder;
  solanaConnection: Connection;
  sessions: Map<string, MonitoringSession>; // Key: walletAddress-tokenAddress-timestamp
  poolToSessions: Map<string, Set<string>>; // Key: poolAddress, Value: Set of sessionKeys
  currentStream: any;
  isStreaming: boolean;
  shouldStop: boolean;
  grpcUrl: string;
  xToken: string;
  monitoredPools: Set<string>; // Track which pools we're subscribed to

  constructor(solanaConnection: Connection) {
    this.grpcClient = null;
    this.solanaConnection = solanaConnection;
    this.sessions = new Map();
    this.poolToSessions = new Map();
    this.currentStream = null;
    this.isStreaming = false;
    this.shouldStop = false;
    this.monitoredPools = new Set();
    
    // Get gRPC credentials from environment
    if (!process.env.GRPC_URL || !process.env.X_TOKEN) {
      throw new Error("Missing GRPC_URL or X_TOKEN environment variables for pool monitoring");
    }
    this.grpcUrl = process.env.GRPC_URL;
    this.xToken = process.env.X_TOKEN;

    // Initialize gRPC client
    this.grpcClient = new Client(this.grpcUrl, this.xToken, {
      "grpc.keepalive_permit_without_calls": 1,
      "grpc.keepalive_time_ms": 10000,
      "grpc.keepalive_timeout_ms": 1000,
      "grpc.default_compression_algorithm": 2,
    });

    // Load IDL files
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

    // Don't start stream here - it will start when first pool is added
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
      // Get SOL price from database
      const solPriceUsd = await dbService.getLatestSolPrice();
      if (!solPriceUsd) {
        console.log('⚠️ Failed to fetch SOL price for pool monitoring');
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

  handlePoolUpdate(poolAddress: string, accountData: string): void {
    // First check if this pool is still being monitored
    if (!this.monitoredPools.has(poolAddress)) {
      // Pool was removed from monitoring, ignore this update
      return;
    }

    // Find all sessions monitoring this pool
    const sessionKeys = this.poolToSessions.get(poolAddress);
    if (!sessionKeys || sessionKeys.size === 0) {
      // No sessions for this pool - remove it from monitoring
      this.monitoredPools.delete(poolAddress);
      this.poolToSessions.delete(poolAddress);
      console.log(`🧹 Cleaned up orphaned pool ${poolAddress.substring(0, 8)}... (no sessions)`);
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
      if (sessionKeys.size === 0) {
        this.monitoredPools.delete(poolAddress);
        this.poolToSessions.delete(poolAddress);
        console.log(`🧹 Cleaned up pool ${poolAddress.substring(0, 8)}... (all sessions were stale)`);
        return;
      }
    }

    try {
      // Decode account data (accountData is base64 encoded string)
      const accountName = this.getAccountName(accountData);
      if (accountName !== 'BondingCurve' && accountName !== 'Pool') {
        return; // Only process BondingCurve or Pool accounts
      }

      const decodedData = this.accountCoder.decodeAny(Buffer.from(accountData, 'base64'));
      if (!decodedData) {
        console.log(`⚠️ Failed to decode account data for pool ${poolAddress.substring(0, 8)}...`);
        return;
      }
      bnLayoutFormatter(decodedData);

      // Process update for each session monitoring this pool
      sessionKeys.forEach(sessionKey => {
        const session = this.sessions.get(sessionKey);
        if (!session) {
          return;
        }

        // Calculate price and market cap
        this.calculatePriceAndMarketCap(poolAddress, session.tokenAddress, decodedData)
          .then(result => {
            if (!result) return;

            const { priceSol, priceUsd, marketCap } = result;
            const timestamp = Date.now();

            // Update current values
            session.currentPriceSol = priceSol;
            session.currentPriceUsd = priceUsd;
            session.currentMarketCap = marketCap;

            // Update peak from buy to sell (ONLY before sell signal is received)
            if (!session.stopSignal) {
              if (!session.peakBuyToSell || priceUsd > session.peakBuyToSell.peakPriceUsd) {
                session.peakBuyToSell = {
                  peakPriceSol: priceSol,
                  peakPriceUsd: priceUsd,
                  peakMarketCap: marketCap,
                  timestamp
                };
                console.log(`📈 Updated peak_buy_to_sell: $${priceUsd.toFixed(6)} (MCap: $${marketCap.toFixed(2)}) for ${sessionKey.substring(0, 20)}...`);
              }
            }

            // Update peak from sell to end (ONLY after sell signal is received)
            if (session.stopSignal) {
              // Ensure peakSellToEnd is initialized (should have been set in handleSellSignal, but double-check)
              if (!session.peakSellToEnd) {
                session.peakSellToEnd = {
                  peakPriceSol: priceSol,
                  peakPriceUsd: priceUsd,
                  peakMarketCap: marketCap,
                  timestamp
                };
                console.log(`📈 Initialized peak_sell_to_end from update: $${priceUsd.toFixed(6)} (MCap: $${marketCap.toFixed(2)}) for ${sessionKey.substring(0, 20)}...`);
              } else if (priceUsd > session.peakSellToEnd.peakPriceUsd) {
                session.peakSellToEnd = {
                  peakPriceSol: priceSol,
                  peakPriceUsd: priceUsd,
                  peakMarketCap: marketCap,
                  timestamp
                };
                console.log(`📈 Updated peak_sell_to_end: $${priceUsd.toFixed(6)} (MCap: $${marketCap.toFixed(2)}) for ${sessionKey.substring(0, 20)}...`);
              }
            }

            console.log(`📊 Pool ${poolAddress.substring(0, 8)}... | Price: ${priceSol.toFixed(10)} SOL ($${priceUsd.toFixed(6)}) | MCap: $${marketCap.toFixed(2)}`);
          })
          .catch(error => {
            console.error('Error processing pool update:', error);
          });
      });
    } catch (error) {
      console.error('Error handling pool update:', error);
    }
  }

  async startStream(): Promise<void> {
    if (!this.grpcClient) {
      throw new Error('gRPC client not initialized');
    }

    // Don't start if there are no pools to monitor
    if (this.monitoredPools.size === 0) {
      console.log('⚠️ Cannot start stream: no pools to monitor');
      return;
    }

    // Prevent multiple streams - if already streaming, don't start another
    if (this.isStreaming && this.currentStream) {
      console.log('⚠️ Stream already running, skipping start');
      return;
    }

    // Clean up any existing stream reference
    if (this.currentStream) {
      try {
        this.currentStream.end();
      } catch (error) {
        // Ignore errors when ending old stream
      }
      this.currentStream = null;
    }

    this.shouldStop = false;
    this.isStreaming = true;

    // Start streaming in background
    this.handleStream().catch(error => {
      console.error('gRPC stream error:', error);
      this.isStreaming = false;
      this.currentStream = null;
      
      // Retry after delay only if there are pools to monitor and we're not stopping
      if (!this.shouldStop && this.monitoredPools.size > 0) {
        setTimeout(() => {
          // Double-check before retrying
          if (!this.shouldStop && this.monitoredPools.size > 0 && !this.isStreaming) {
            console.log('🔄 Retrying stream connection...');
            this.startStream();
          }
        }, 1000);
      }
    });
  }

  private async handleStream(): Promise<void> {
    if (!this.grpcClient) {
      throw new Error('gRPC client not initialized');
    }

    console.log('🔌 Starting gRPC stream for pool monitoring...');
    const stream = await this.grpcClient.subscribe();
    this.currentStream = stream;

    // Handle stream events
    stream.on("error", (error) => {
      console.error("❌ gRPC stream error:", error);
      this.isStreaming = false;
      // Only end if this is still the current stream
      if (this.currentStream === stream) {
        this.currentStream = null;
        stream.end();
      }
    });

    stream.on("end", () => {
      console.log("🔌 gRPC stream ended");
      // Only update state if this is still the current stream
      if (this.currentStream === stream) {
        this.isStreaming = false;
        this.currentStream = null;
      }
    });

    stream.on("close", () => {
      console.log("🔌 gRPC stream closed");
      // Only update state if this is still the current stream
      if (this.currentStream === stream) {
        this.isStreaming = false;
        this.currentStream = null;
      }
    });

    // Handle account updates
    stream.on("data", async (data) => {
      try {
        if (data?.account) {
          const poolAddress = bs58.encode(data.account.account.pubkey);
          // Account data is already base64 encoded string
          const accountData = data.account.account.data;
          
          console.log(`📥 Received account update for pool ${poolAddress.substring(0, 8)}...`);
          this.handlePoolUpdate(poolAddress, accountData);
        }
      } catch (error) {
        console.error('Error processing gRPC data:', error);
      }
    });

    // Build initial subscription request with all monitored pools
    // This should only be called when there's at least one pool
    if (this.monitoredPools.size === 0) {
      console.log('⚠️ No pools to subscribe to, ending stream');
      stream.end();
      this.isStreaming = false;
      return;
    }

    const req: SubscribeRequest = {
      slots: {},
      accounts: {
        pumpfun: {
          account: Array.from(this.monitoredPools),
          filters: [],
          owner: []
        }
      },
      transactions: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.PROCESSED,
      entry: {},
      transactionsStatus: {}
    };

    // Send initial subscribe request
    await new Promise<void>((resolve, reject) => {
      stream.write(req, (err: any) => {
        if (err === null || err === undefined) {
          console.log(`✅ Subscribed to ${this.monitoredPools.size} pool(s) via gRPC`);
          resolve();
        } else {
          reject(err);
        }
      });
    });
  }

  async updateSubscription(): Promise<void> {
    // If no pools to monitor, stop the stream if it's running
    if (this.monitoredPools.size === 0) {
      if (this.currentStream && this.isStreaming) {
        console.log('🛑 No pools to monitor, stopping gRPC stream...');
        this.shouldStop = true;
        try {
          this.currentStream.cancel();
          this.currentStream.end();
        } catch (error) {
          // Ignore errors
        }
        this.currentStream = null;
        this.isStreaming = false;
      }
      return;
    }

    // If stream is not running, start it
    if (!this.currentStream || !this.isStreaming) {
      await this.startStream();
      return;
    }

    // Dynamically update the subscription without restarting the stream
    try {
      const req: SubscribeRequest = {
        slots: {},
        accounts: {
          pumpfun: {
            account: Array.from(this.monitoredPools),
            filters: [],
            owner: []
          }
        },
        transactions: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        commitment: CommitmentLevel.PROCESSED,
        entry: {},
        transactionsStatus: {}
      };

      console.log(`🔄 Updating gRPC subscription: ${this.monitoredPools.size} pool(s) - ${Array.from(this.monitoredPools).map(p => p.substring(0, 8)).join(', ')}`);
      
      // Wait for the subscription update to be sent
      await new Promise<void>((resolve, reject) => {
        const streamRef = this.currentStream;
        if (!streamRef) {
          reject(new Error('Stream no longer exists'));
          return;
        }
        
        streamRef.write(req, (err: any) => {
          if (err === null || err === undefined) {
            console.log(`✅ Updated gRPC subscription: ${this.monitoredPools.size} pool(s)`);
            resolve();
          } else {
            reject(err);
          }
        });
      });
    } catch (error) {
      console.error('Failed to update subscription:', error);
      // If update fails, restart the stream only if we still have pools
      if (this.monitoredPools.size > 0) {
        if (this.currentStream) {
          try {
            this.currentStream.end();
          } catch (e) {
            // Ignore
          }
        }
        this.isStreaming = false;
        this.currentStream = null;
        await new Promise(resolve => setTimeout(resolve, 500));
        if (this.monitoredPools.size > 0) {
          await this.startStream();
        }
      }
    }
  }

  async startMonitoring(
    walletAddress: string,
    tokenAddress: string,
    poolAddress: string,
    maxDuration: number,
    initialPriceData?: { priceUsd: number; priceSol: number; marketCap: number }
  ): Promise<string> {
    // Use a unique session key that includes timestamp
    const timestamp = Date.now();
    const sessionKey = `${walletAddress}-${tokenAddress}-${timestamp}`;

    // Check if already monitoring this exact session
    if (this.sessions.has(sessionKey)) {
      console.log(`⚠️ Already monitoring ${sessionKey}`);
      return sessionKey;
    }

    // Initialize peakBuyToSell with buy transaction price if available
    let initialPeakBuyToSell: PeakData | null = null;
    if (initialPriceData) {
      initialPeakBuyToSell = {
        peakPriceSol: initialPriceData.priceSol,
        peakPriceUsd: initialPriceData.priceUsd,
        peakMarketCap: initialPriceData.marketCap,
        timestamp: Date.now()
      };
      console.log(`📈 Initialized peak_buy_to_sell with buy price: $${initialPriceData.priceUsd.toFixed(6)} (MCap: $${initialPriceData.marketCap.toFixed(2)})`);
    }

    const session: MonitoringSession = {
      walletAddress,
      tokenAddress,
      poolAddress,
      startTime: Date.now(),
      maxDuration,
      stopSignal: false,
      peakBuyToSell: initialPeakBuyToSell,
      peakSellToEnd: null,
      currentPriceSol: initialPriceData?.priceSol || 0,
      currentPriceUsd: initialPriceData?.priceUsd || 0,
      currentMarketCap: initialPriceData?.marketCap || 0,
      timeoutId: null,
      stopAfterSellTimeout: null
    };

    this.sessions.set(sessionKey, session);

    // Add pool to monitored pools if not already there
    const isNewPool = !this.monitoredPools.has(poolAddress);
    if (isNewPool) {
      this.monitoredPools.add(poolAddress);
      console.log(`➕ Added pool ${poolAddress.substring(0, 8)}... to monitoring (total: ${this.monitoredPools.size})`);
    }

    // Track which sessions are monitoring this pool
    if (!this.poolToSessions.has(poolAddress)) {
      this.poolToSessions.set(poolAddress, new Set());
    }
    this.poolToSessions.get(poolAddress)!.add(sessionKey);

    // Update gRPC subscription if this is a new pool
    if (isNewPool) {
      await this.updateSubscription();
    }

    // Set timeout for maximum duration
    session.timeoutId = setTimeout(() => {
      this.stopMonitoring(sessionKey, false);
    }, maxDuration * 1000);

    const activeSessionsCount = Array.from(this.sessions.values()).filter(s => !s.stopSignal).length;
    console.log(`🔍 Started monitoring pool ${poolAddress.substring(0, 8)}... for wallet ${walletAddress.substring(0, 8)}... (max ${maxDuration}s) [Active sessions: ${activeSessionsCount}]`);

    return sessionKey;
  }

  signalSell(sessionKey: string, sellPriceData?: { priceUsd: number; priceSol: number; marketCap: number }): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      this.handleSellSignal(sessionKey, session, sellPriceData);
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
      this.handleSellSignal(mostRecentSession.sessionKey, mostRecentSession.session, sellPriceData);
      return;
    }
    
    console.log(`⚠️ No active monitoring session found for ${sessionKey}`);
  }

  private handleSellSignal(sessionKey: string, session: MonitoringSession, sellPriceData?: { priceUsd: number; priceSol: number; marketCap: number }): void {
    console.log(`🛑 Sell signal received for ${session.walletAddress.substring(0, 8)}...-${session.tokenAddress.substring(0, 8)}..., stopping in 10 seconds...`);
    
    // Clear the maxDuration timeout so it doesn't interfere
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = null;
    }
    
    // Set stop signal
    session.stopSignal = true;
    
    // Initialize peakSellToEnd with sell transaction price (preferred) or current price
    if (sellPriceData) {
      // Use sell transaction price
      session.peakSellToEnd = {
        peakPriceSol: sellPriceData.priceSol,
        peakPriceUsd: sellPriceData.priceUsd,
        peakMarketCap: sellPriceData.marketCap,
        timestamp: Date.now()
      };
      console.log(`📈 Initialized peak_sell_to_end with sell price: $${sellPriceData.priceUsd.toFixed(6)} (MCap: $${sellPriceData.marketCap.toFixed(2)})`);
      // Also update current values
      session.currentPriceSol = sellPriceData.priceSol;
      session.currentPriceUsd = sellPriceData.priceUsd;
      session.currentMarketCap = sellPriceData.marketCap;
    } else if (session.currentPriceUsd > 0) {
      // Fallback to current price if available
      session.peakSellToEnd = {
        peakPriceSol: session.currentPriceSol,
        peakPriceUsd: session.currentPriceUsd,
        peakMarketCap: session.currentMarketCap,
        timestamp: Date.now()
      };
      console.log(`📈 Initialized peak_sell_to_end with current price: $${session.currentPriceUsd.toFixed(6)} (MCap: $${session.currentMarketCap.toFixed(2)})`);
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
      if (poolSessions.size === 0 || !hasActiveSessions) {
        this.poolToSessions.delete(poolAddress);
        // Remove pool from monitored set BEFORE updating subscription
        const wasRemoved = this.monitoredPools.delete(poolAddress);
        if (wasRemoved) {
          console.log(`➖ Removed pool ${poolAddress.substring(0, 8)}... from monitoring (no active sessions, remaining pools: ${this.monitoredPools.size})`);
          // Update subscription to remove this pool (this will stop stream if no pools left)
          await this.updateSubscription();
        }
      } else {
        console.log(`ℹ️ Pool ${poolAddress.substring(0, 8)}... still has ${poolSessions.size} active session(s)`);
      }
    }

    // Save peak prices to database (always save, whether after sell or timeout)
    console.log(`💾 Preparing to save peak prices for ${sessionKey}:`);
    console.log(`   peakBuyToSell: ${session.peakBuyToSell ? `$${session.peakBuyToSell.peakPriceUsd.toFixed(6)}` : 'null'}`);
    console.log(`   peakSellToEnd: ${session.peakSellToEnd ? `$${session.peakSellToEnd.peakPriceUsd.toFixed(6)}` : 'null'}`);
    await this.savePeakPrices(session);

    this.sessions.delete(sessionKey);
    console.log(`✅ Stopped monitoring ${sessionKey}`);
  }

  async savePeakPrices(session: MonitoringSession): Promise<void> {
    try {
      const peakBuyToSell = session.peakBuyToSell || {
        peakPriceSol: 0,
        peakPriceUsd: 0,
        peakMarketCap: 0,
        timestamp: 0
      };

      const peakSellToEnd = session.peakSellToEnd || {
        peakPriceSol: 0,
        peakPriceUsd: 0,
        peakMarketCap: 0,
        timestamp: 0
      };

      console.log(`💾 Saving peak prices:`);
      console.log(`   Buy to Sell: Price SOL=${peakBuyToSell.peakPriceSol}, Price USD=${peakBuyToSell.peakPriceUsd}, MCap=${peakBuyToSell.peakMarketCap}`);
      console.log(`   Sell to End: Price SOL=${peakSellToEnd.peakPriceSol}, Price USD=${peakSellToEnd.peakPriceUsd}, MCap=${peakSellToEnd.peakMarketCap}`);

      await dbService.updateWalletPeakPrices(
        session.walletAddress,
        session.tokenAddress,
        peakBuyToSell.peakPriceSol,
        peakBuyToSell.peakPriceUsd,
        peakBuyToSell.peakMarketCap,
        peakSellToEnd.peakPriceSol,
        peakSellToEnd.peakPriceUsd,
        peakSellToEnd.peakMarketCap
      );

      console.log(`💾 Saved peak prices for ${session.walletAddress.substring(0, 8)}... - ${session.tokenAddress.substring(0, 8)}...`);
    } catch (error) {
      console.error('Failed to save peak prices:', error);
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
    this.shouldStop = true;
    if (this.currentStream) {
      this.currentStream.end();
    }
    this.sessions.clear();
    this.poolToSessions.clear();
    this.monitoredPools.clear();
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
      
      // Create pool monitor (uses Yellowstone gRPC for account subscriptions)
      poolMonitor = new LiquidityPoolMonitor(solanaConnection);
      PoolMonitoringService.instance.monitor = poolMonitor;
      
      console.log('✅ Pool monitoring service initialized (using Yellowstone gRPC)');
    }

    return PoolMonitoringService.instance;
  }

  async startMonitoring(
    walletAddress: string,
    tokenAddress: string,
    poolAddress: string,
    maxDuration: number = 3600, // Default 1 hour
    initialPriceData?: { priceUsd: number; priceSol: number; marketCap: number }
  ): Promise<string> {
    if (!this.monitor) {
      throw new Error('Pool monitor not initialized');
    }

    return this.monitor.startMonitoring(walletAddress, tokenAddress, poolAddress, maxDuration, initialPriceData);
  }

  signalSell(walletAddress: string, tokenAddress: string, sellPriceData?: { priceUsd: number; priceSol: number; marketCap: number }): void {
    if (!this.monitor) {
      return;
    }

    const sessionKey = `${walletAddress}-${tokenAddress}`;
    this.monitor.signalSell(sessionKey, sellPriceData);
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
