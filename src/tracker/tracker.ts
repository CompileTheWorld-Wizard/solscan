require("dotenv").config();
import { dbService } from "../database";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { tokenQueueService } from "../services/tokenQueueService";
import { PoolMonitoringService } from "../services/poolMonitoringService";
import { StreamerService } from "../services/streamerService";
import { convertEventToTrackerFormat } from "../services/eventConverter";
import { ParsedEvent, ParsedTransaction } from "../services/type";
import { extractBondingCurveForEvent } from "../services/utils/transactionUtils";
import { redisService } from "../services/redisService";

class TransactionTracker {
  private isRunning: boolean = false;
  private addresses: string[] = [];
  private solanaConnection: Connection | null = null;
  private poolMonitoringService: PoolMonitoringService | null = null;
  private streamerService: StreamerService | null = null;
  private streamerInitialized: boolean = false;

  constructor() {
    // Initialize with empty addresses
  }

  /**
   * Initialize the tracker with streamer
   */
  initialize() {
    if (!process.env.GRPC_URL || !process.env.X_TOKEN) {
      throw new Error("Missing GRPC_URL or X_TOKEN environment variables");
    }

    const grpcUrl = process.env.GRPC_URL;
    const xToken = process.env.X_TOKEN;

    // Initialize Solana RPC connection for wallet analysis and pool account fetching
    const shyftApiKey = process.env.X_TOKEN;
    const rpcUrl = `https://dillwifit.shyft.to/${shyftApiKey}`;
    this.solanaConnection = new Connection(rpcUrl, "confirmed");

    // Initialize Redis service for SOL price
    redisService.initialize();

    // Initialize pool monitoring service
    PoolMonitoringService.getInstance(this.solanaConnection).then(service => {
      this.poolMonitoringService = service;
      console.log('✅ Pool monitoring service initialized successfully');
    }).catch(error => {
      console.error('❌ Failed to initialize pool monitoring service:', error?.message || error);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
      // Continue without pool monitoring - tracker will still work
      this.poolMonitoringService = null;
    });

    // Initialize streamer for PumpFun and PumpAmm
    try {
      this.streamerService = new StreamerService();
      this.streamerService.initialize(grpcUrl, xToken);
      this.streamerInitialized = true;
      
      // Set up callback for events
      this.streamerService.onData((tx: ParsedTransaction) => {
        this.handleTransaction(tx);
      });
      
      console.log("✅ Streamer initialized (will track wallet addresses when set)");
    } catch (error: any) {
      console.error('Failed to initialize streamer:', error?.message || error);
      this.streamerInitialized = false;
    }

    console.log("✅ Tracker initialized");
  }

  /**
   * Set addresses to track (wallet addresses for PumpFun and PumpAmm transactions)
   */
  setAddresses(addresses: string[]) {
    const newAddresses = addresses.filter(addr => addr.trim().length > 0);
    
    // If streamer is initialized and running, update tracked addresses
    if (this.streamerInitialized && this.streamerService) {
      // Remove old addresses that are not in new list
      const addressesToRemove = this.addresses.filter(addr => !newAddresses.includes(addr));
      if (addressesToRemove.length > 0) {
        this.streamerService.removeAddresses(addressesToRemove);
      }
      
      // Add new addresses that are not already tracked
      const addressesToAdd = newAddresses.filter(addr => !this.addresses.includes(addr));
      if (addressesToAdd.length > 0) {
        this.streamerService.addAddresses(addressesToAdd);
      }
    }
    
    this.addresses = newAddresses;
    console.log('📍 Addresses set:', this.addresses.length);
    this.addresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr}`);
    });
  }

  /**
   * Get current addresses (kept for API compatibility)
   */
  getAddresses(): string[] {
    return [...this.addresses];
  }

  /**
   * Check if tracker is running
   */
  isTrackerRunning(): boolean {
    return this.isRunning;
  }


  /**
   * Process transaction asynchronously - Module 1: Transaction data processing
   * Handles: save transaction, check dev still holding, calculate market cap/token price, check/register first_buy or first_sell
   * Note: Pool monitoring (Module 2) runs in parallel separately
   */
  private async processTransaction(
    result: any,
    signature: string,
    currentSlot: string | undefined,
    createdAt: string | null
  ): Promise<void> {
    try {
      // Convert slot to number for block_number
      const blockNumber = currentSlot ? parseInt(currentSlot, 10) : null;
      const blockNumberValue = (blockNumber !== null && !isNaN(blockNumber)) ? blockNumber : null;

      // Use createdAt timestamp from stream (slot timestamp) if available, otherwise fallback to current time
      // createdAt is in ISO format: "2025-11-23T06:44:25.792Z"
      let blockTimestamp: number;
      if (createdAt) {
        // Convert ISO timestamp to Unix epoch (seconds)
        blockTimestamp = Math.floor(new Date(createdAt).getTime() / 1000);
      } else {
        // Fallback to current time if createdAt is not available
        blockTimestamp = Math.floor(Date.now() / 1000);
      }

      const txType = result.type?.toUpperCase();
      console.log(`📝 Transaction type: ${result.type} (normalized: ${txType})`);

      // Extract token address for buy/sell events
      const tokenAddress = (txType === 'BUY' || txType === 'SELL') 
        ? this.extractTokenAddress(result) 
        : null;

      // Queue token for info extraction (right after extraction, for BUY/SELL transactions)
      if ((txType === 'BUY' || txType === 'SELL') && tokenAddress) {
        this.extractAndQueueToken(tokenAddress);
      }

      // Save transaction to database (dev_still_holding will be updated asynchronously)
      await dbService.saveTransaction(signature, {
        platform: result.platform,
        type: result.type,
        mint_from: result.mintFrom,
        mint_to: result.mintTo,
        in_amount: result.in_amount,
        out_amount: result.out_amount,
        feePayer: result.feePayer,
        tipAmount: result.tipAmount,
        feeAmount: result.feeAmount,
        blockNumber: blockNumberValue,
        blockTimestamp: blockTimestamp,
        dev_still_holding: null, // Will be updated asynchronously by checkAndSaveDevStillHolding
      });

      // For BUY/SELL transactions, check if creator still holds the token and save result asynchronously (both BUY and SELL)
      if ((txType === 'BUY' || txType === 'SELL') && result.creator && tokenAddress) {
        this.checkAndSaveDevStillHolding(signature, result.creator, tokenAddress).catch(error => {
          console.error(`Failed to check and save dev still holding:`, error?.message || error);
        });
      }

      // Process buy/sell events
      if (txType === 'BUY' || txType === 'SELL') {
        if (!tokenAddress) {
          console.log(`⚠️ No valid token found in ${result.type} transaction (mintFrom: ${result.mintFrom?.substring(0, 8)}, mintTo: ${result.mintTo?.substring(0, 8)})`);
          return;
        }

        console.log(`✅ Processing ${result.type} transaction...`);

        // Get token price in SOL from parseTransaction result
        const tokenPriceSol = result.price ? parseFloat(result.price.toString()) : null;

        if (tokenPriceSol === null || isNaN(tokenPriceSol)) {
          console.log(`⚠️ No valid price found in transaction result for ${signature}`);
          // Still process wallet tracking even without price
          await this.processWalletTracking(result, tokenAddress, signature, txType, null, null);
          return;
        }

        // Calculate market cap, total supply, and token prices
        // Pass platform to determine if it's PumpFun/PumpAmm (fixed supply of 1B)
        const marketCapData = await this.calculateMarketCapData(signature, tokenPriceSol, tokenAddress, result.platform);

        // Update transaction with market cap data
        if (marketCapData) {
          // Only update if we have valid data (don't save null/0 when calculation failed)
          if (marketCapData.marketCap !== null || marketCapData.totalSupply !== null || marketCapData.tokenPriceUsd !== null) {
            await dbService.updateTransactionMarketCap(
              signature,
              marketCapData.marketCap,
              marketCapData.totalSupply,
              tokenPriceSol,
              marketCapData.tokenPriceUsd
            );
          }
        }

        // Process wallet tracking (check/register first_buy or first_sell)
        await this.processWalletTracking(
          result,
          tokenAddress,
          signature,
          txType,
          marketCapData,
          tokenPriceSol
        );
      } else {
        console.log(`⏭️ Skipping - type is ${result.type}`);
      }
    } catch (error: any) {
      console.error(`❌ Error in processTransaction:`, error?.message || error);
    }
  }

  /**
   * Calculate market cap data from token price in SOL
   * @param platform - Platform name (e.g., "PumpFun", "PumpFun Amm") to determine if fixed supply should be used
   */
  private async calculateMarketCapData(
    transactionId: string,
    tokenPriceSol: number,
    tokenAddress: string,
    platform?: string
  ): Promise<{ marketCap: number | null; totalSupply: number | null; tokenPriceUsd: number | null } | null> {
    try {
      // Validate tokenPriceSol
      if (!tokenPriceSol || isNaN(tokenPriceSol) || !isFinite(tokenPriceSol) || tokenPriceSol <= 0) {
        return null;
      }

      // Get SOL price from Redis
      const solPriceUsd = await redisService.getLatestSolPrice();
      if (!solPriceUsd) {
        console.error(`❌ Failed to fetch SOL price from Redis`);
        return null;
      }

      // Calculate token price in USD
      const tokenPriceUsd = tokenPriceSol * solPriceUsd;
      
      if (!tokenPriceUsd || isNaN(tokenPriceUsd) || !isFinite(tokenPriceUsd) || tokenPriceUsd <= 0) {
        return null;
      }

      // Check if this is PumpFun or PumpAmm - they have fixed supply of 1 billion (1,000,000,000) with 6 decimals
      const isPumpFunOrPumpAmm = platform === "PumpFun" || platform === "PumpFun Amm";
      
      let marketCap: number | null = null;
      let totalSupply: number | null = null;
      let decimals: number = 6; // Default for PumpFun tokens

      if (isPumpFunOrPumpAmm) {
        // PumpFun/PumpAmm tokens have fixed supply of 1 billion
        totalSupply = 1_000_000_000; // 1 billion tokens
        decimals = 6; // PumpFun tokens use 6 decimals
        
        // Calculate market cap = total supply * token price in USD
        marketCap = totalSupply * tokenPriceUsd;
      } else {
        // For other platforms, fetch token supply from RPC
        const supplyData = await this.getTokenTotalSupply(tokenAddress);

        if (supplyData) {
          totalSupply = supplyData.supply;
          decimals = supplyData.decimals;
          
          if (totalSupply && !isNaN(totalSupply) && isFinite(totalSupply) && totalSupply > 0) {
            // Calculate market cap = total supply * token price in USD
            marketCap = totalSupply * tokenPriceUsd;
          }
        }
      }

      const result = { marketCap, totalSupply, tokenPriceUsd };
      return result;
    } catch (error: any) {
      console.error(`❌ Failed to calculate market cap data for ${transactionId}:`, error?.message || error);
      return null;
    }
  }

  /**
   * Process wallet tracking - check/register first_buy or first_sell
   */
  private async processWalletTracking(
    result: any,
    tokenAddress: string,
    signature: string,
    txType: string,
    marketCapData: { marketCap: number | null; totalSupply: number | null; tokenPriceUsd: number | null } | null,
    tokenPriceSol: number | null
  ): Promise<void> {
    try {
      const walletAddress = result.feePayer;
      const inAmount = result.in_amount?.toString() || '0';
      const outAmount = result.out_amount?.toString() || '0';

      // Determine amount based on transaction type
      const amount = txType === 'BUY' ? inAmount : outAmount;

      // Check if this is first_buy (for BUY) or first_sell (for SELL)
      // Note: saveWalletTokenPair will handle the first_buy/first_sell registration automatically
      // We just need to check for logging purposes
      let isFirst = false;
      if (txType === 'BUY') {
        isFirst = await dbService.isFirstBuy(walletAddress, tokenAddress);
      } else if (txType === 'SELL') {
        // For SELL, we can check by trying to get wallet tokens and checking first_sell_timestamp
        // But since saveWalletTokenPair handles it, we'll just assume it might be first
        // The actual check happens in saveWalletTokenPair via COALESCE
        isFirst = true; // Will be determined by saveWalletTokenPair
      }

      // Build market data
      let marketData: {
        supply: string | null;
        price: number | null;
        decimals: number | null;
        market_cap: number | null;
      } | null = null;

      if (marketCapData) {
        // Determine decimals based on platform
        // PumpFun and PumpAmm tokens always use 6 decimals
        const isPumpFunOrPumpAmm = result.platform === "PumpFun" || result.platform === "PumpFun Amm";
        let decimals: number | null = null;
        
        if (isPumpFunOrPumpAmm) {
          decimals = 6; // PumpFun/PumpAmm tokens always use 6 decimals
        } else if (tokenAddress) {
          // For other platforms, fetch decimals from token supply
          const supplyData = await this.getTokenTotalSupply(tokenAddress);
          if (supplyData) {
            decimals = supplyData.decimals;
          }
        }

        marketData = {
          market_cap: marketCapData.marketCap,
          supply: marketCapData.totalSupply ? marketCapData.totalSupply.toString() : null,
          price: marketCapData.tokenPriceUsd,
          decimals: decimals
        };
      }

      // Calculate open position count for BUY events
      let openPositionCount: number | null = null;
      if (txType === 'BUY' && this.solanaConnection) {
        try {
          openPositionCount = await this.calculateOpenPositionCount(walletAddress);
        } catch (error: any) {
          console.error(`Failed to calculate open position count:`, error?.message || error);
        }
      }

      // Save wallet-token pair (this will register first_buy or first_sell if it's the first)
      await dbService.saveWalletTokenPair(
        walletAddress,
        tokenAddress,
        txType as 'BUY' | 'SELL',
        amount,
        marketData,
        openPositionCount
      );

      console.log(`💾 Wallet ${txType} tracked: ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}... (First: ${isFirst})`);

      // Fetch and save creator token count (at the end, as requested, after 45 seconds)
      if (result.creator) {
        setTimeout(() => {
          this.fetchAndSaveCreatorTokenCount(result.creator, tokenAddress).catch(error => {
            console.error(`Failed to fetch and save creator token count:`, error?.message || error);
          });
        }, 45000); // 45 seconds delay
      }
    } catch (error: any) {
      console.error(`❌ Error in processWalletTracking:`, error?.message || error);
    }
  }

  /**
   * Calculate open position count for a wallet
   */
  private async calculateOpenPositionCount(walletAddress: string): Promise<number> {
    if (!this.solanaConnection) {
      return 0;
    }

    try {
      const publicKey = new PublicKey(walletAddress);

      // Get parsed token accounts (SPL Token Program)
      const parsedTokenAccounts = await this.solanaConnection.getParsedTokenAccountsByOwner(publicKey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      });

      // Get parsed token accounts (SPL Token-2022 Program)
      const parsed2022TokenAccounts = await this.solanaConnection.getParsedTokenAccountsByOwner(publicKey, {
        programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
      });

      // Get all token mints that have non-zero balance
      const holdingTokenMints = new Set<string>();

      // Process SPL Token accounts
      for (const account of parsedTokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (parsedInfo && parsedInfo.tokenAmount) {
          const balance = parseFloat(parsedInfo.tokenAmount.uiAmountString || '0');
          if (balance > 0) {
            const mint = parsedInfo.mint;
            if (mint) {
              holdingTokenMints.add(mint);
            }
          }
        }
      }

      // Process Token-2022 accounts
      for (const account of parsed2022TokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (parsedInfo && parsedInfo.tokenAmount) {
          const balance = parseFloat(parsedInfo.tokenAmount.uiAmountString || '0');
          if (balance > 0) {
            const mint = parsedInfo.mint;
            if (mint) {
              holdingTokenMints.add(mint);
            }
          }
        }
      }

      // Calculate open positions count
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      let openTradeCount = 0;

      for (const tokenMint of holdingTokenMints) {
        // Skip SOL mint
        if (tokenMint === SOL_MINT) {
          continue;
        }

        // Calculate buy count for this specific token
        const buyCount = await dbService.getBuyCountForToken(walletAddress, tokenMint);

        // Calculate sell count for this specific token
        const sellCount = await dbService.getSellCountForToken(walletAddress, tokenMint);

        // Only count if buyCount > sellCount
        if (buyCount > sellCount) {
          openTradeCount += 1;
        }
      }

      return openTradeCount;
    } catch (error: any) {
      console.error(`Failed to calculate open position count:`, error?.message || error);
      return 0;
    }
  }

  /**
   * Process pool monitoring (Module 2) - runs in parallel with processTransaction
   * Handles: start pool monitoring for first buys, signal sell events
   */
  private async processPoolMonitoring(
    result: any,
    tokenAddress: string,
    signature: string,
    txType: string,
    createdAt: string | null,
    currentSlot: string | undefined
  ): Promise<void> {
    if (!this.poolMonitoringService || !result.pool) {
      return;
    }

    try {
      const walletAddress = result.feePayer;
      const poolAddress = result.pool;

      // Get token price in SOL from parseTransaction result
      const tokenPriceSol = result.price ? parseFloat(result.price.toString()) : null;

      // Calculate market cap data for pool monitoring (independent calculation)
      let marketCapData: { marketCap: number | null; totalSupply: number | null; tokenPriceUsd: number | null } | null = null;
      if (tokenPriceSol !== null && !isNaN(tokenPriceSol)) {
        marketCapData = await this.calculateMarketCapData(signature, tokenPriceSol, tokenAddress);
      }

      if (txType === 'BUY') {
        // Check if this is the first buy
        const isFirstBuy = await dbService.isFirstBuy(walletAddress, tokenAddress);

        if (isFirstBuy) {
          const maxDuration = parseInt(process.env.POOL_MONITORING_MAX_DURATION || '60', 10);

          // Prepare initial price data
          let initialPriceData: { priceUsd: number; priceSol: number; marketCap: number } | undefined;
          if (marketCapData && marketCapData.tokenPriceUsd && tokenPriceSol && marketCapData.marketCap) {
            initialPriceData = {
              priceUsd: marketCapData.tokenPriceUsd,
              priceSol: tokenPriceSol,
              marketCap: marketCapData.marketCap
            };
          } else if (marketCapData && marketCapData.tokenPriceUsd && marketCapData.marketCap) {
            // Try to get SOL price if we have USD price
            try {
              const solPriceUsd = await redisService.getLatestSolPrice();
              if (solPriceUsd && solPriceUsd > 0) {
                const priceSol = marketCapData.tokenPriceUsd / solPriceUsd;
                initialPriceData = {
                  priceUsd: marketCapData.tokenPriceUsd,
                  priceSol: priceSol,
                  marketCap: marketCapData.marketCap
                };
              }
            } catch (error) {
              // Continue without SOL price
            }
          }

          await this.poolMonitoringService.startMonitoring(
            walletAddress,
            tokenAddress,
            poolAddress,
            maxDuration,
            initialPriceData,
            createdAt,
            currentSlot || null,
            signature // Pass first buy transaction ID
          );
          console.log(`🔍 Started pool monitoring for first buy: ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}...${currentSlot ? ` (from slot ${currentSlot})` : ''}`);
        }
      } else if (txType === 'SELL') {
        // Signal sell event
        let sellPriceData: { priceUsd: number; priceSol: number; marketCap: number } | undefined;
        if (marketCapData && marketCapData.tokenPriceUsd && tokenPriceSol && marketCapData.marketCap) {
          sellPriceData = {
            priceUsd: marketCapData.tokenPriceUsd,
            priceSol: tokenPriceSol,
            marketCap: marketCapData.marketCap
          };
        } else if (marketCapData && marketCapData.tokenPriceUsd && marketCapData.marketCap) {
          // Try to get SOL price
          try {
            const solPriceUsd = await redisService.getLatestSolPrice();
            if (solPriceUsd && solPriceUsd > 0) {
              const priceSol = marketCapData.tokenPriceUsd / solPriceUsd;
              sellPriceData = {
                priceUsd: marketCapData.tokenPriceUsd,
                priceSol: priceSol,
                marketCap: marketCapData.marketCap
              };
            }
          } catch (error) {
            // Continue without SOL price
          }
        }

        this.poolMonitoringService.signalSell(walletAddress, tokenAddress, sellPriceData, createdAt, signature); // Pass first sell transaction ID
        console.log(`🛑 Signaled sell event for pool monitoring: ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}...`);
      }
    } catch (error: any) {
      console.error(`Failed to process pool monitoring:`, error?.message || error);
    }
  }

  /**
   * Extract the non-SOL token address from buy/sell transaction
   * @returns Token address or null if not found
   */
  private extractTokenAddress(result: any): string | null {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const txType = result.type?.toUpperCase();

    if (txType === 'BUY') {
      // For BUY: mintTo is the token we're buying (should not be SOL)
      if (result.mintTo && result.mintTo !== SOL_MINT) {
        return result.mintTo;
      }
    } else if (txType === 'SELL') {
      // For SELL: mintFrom is the token we're selling (should not be SOL)
      if (result.mintFrom && result.mintFrom !== SOL_MINT) {
        return result.mintFrom;
      }
    }

    return null;
  }

  /**
   * Fetch total supply for a token using web3.js
   * @param tokenAddress - Token mint address
   * @returns Total supply in human-readable format (adjusted for decimals) or null if failed
   */
  private async getTokenTotalSupply(tokenAddress: string): Promise<{ supply: number; decimals: number } | null> {
    if (!this.solanaConnection) {
      return null;
    }

    try {
      const mintPublicKey = new PublicKey(tokenAddress);
      const tokenSupply = await this.solanaConnection.getTokenSupply(mintPublicKey);

      if (!tokenSupply || !tokenSupply.value) {
        return null;
      }

      const rawSupply = parseFloat(tokenSupply.value.amount);
      const decimals = tokenSupply.value.decimals;
      
      if (isNaN(rawSupply) || !isFinite(rawSupply) || rawSupply <= 0) {
        return null;
      }
      
      if (isNaN(decimals) || decimals < 0 || decimals > 18) {
        return null;
      }

      const supply = rawSupply / Math.pow(10, decimals);

      if (supply <= 0 || !isFinite(supply)) {
        return null;
      }

      return { supply, decimals };
    } catch (error: any) {
      console.error(`❌ Failed to fetch token supply for ${tokenAddress.substring(0, 8)}...:`, error?.message || error);
      return null;
    }
  }

  /**
   * Check if creator still holds the token
   */
  private async checkCreatorStillHolding(creatorAddress: string, tokenAddress: string): Promise<boolean> {
    if (!this.solanaConnection || !creatorAddress || !tokenAddress) {
      return false;
    }

    try {
      const creatorPublicKey = new PublicKey(creatorAddress);
      const tokenMint = new PublicKey(tokenAddress);

      // Get parsed token accounts (SPL Token Program)
      const parsedTokenAccounts = await this.solanaConnection.getParsedTokenAccountsByOwner(creatorPublicKey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      });

      // Get parsed token accounts (SPL Token-2022 Program)
      const parsed2022TokenAccounts = await this.solanaConnection.getParsedTokenAccountsByOwner(creatorPublicKey, {
        programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
      });

      // Check SPL Token accounts
      for (const account of parsedTokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (parsedInfo && parsedInfo.mint === tokenAddress) {
          const balance = parseFloat(parsedInfo.tokenAmount.uiAmountString || '0');
          return balance > 0;
        }
      }

      // Check Token-2022 accounts
      for (const account of parsed2022TokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (parsedInfo && parsedInfo.mint === tokenAddress) {
          const balance = parseFloat(parsedInfo.tokenAmount.uiAmountString || '0');
          return balance > 0;
        }
      }

      return false;
    } catch (error: any) {
      console.error(`❌ Failed to check creator token balance:`, error?.message || error);
      return false;
    }
  }

  /**
   * Utility function to check if dev still holding and save result in database asynchronously
   * Can be called with or without await - errors are handled gracefully
   * @param transactionSignature - Transaction signature (transaction_id)
   * @param creatorAddress - Creator wallet address
   * @param tokenAddress - Token mint address
   * @returns Promise that resolves when the check and save operation is complete
   */
  async checkAndSaveDevStillHolding(
    transactionSignature: string,
    creatorAddress: string,
    tokenAddress: string
  ): Promise<void> {
    try {
      if (!transactionSignature || !creatorAddress || !tokenAddress) {
        console.error(`⚠️ Missing required parameters for checkAndSaveDevStillHolding:`, {
          transactionSignature: !!transactionSignature,
          creatorAddress: !!creatorAddress,
          tokenAddress: !!tokenAddress
        });
        return;
      }

      console.log(`🔍 Checking dev still holding for tx: ${transactionSignature.substring(0, 8)}...`);

      // Check if creator still holds the token
      const devStillHolding = await this.checkCreatorStillHolding(creatorAddress, tokenAddress);

      console.log(`💾 Dev (${creatorAddress.substring(0, 8)}...) still holding: ${devStillHolding}`);

      // Save result to database asynchronously
      await dbService.updateTransactionDevHolding(transactionSignature, devStillHolding);

      console.log(`✅ Successfully updated dev_still_holding for tx: ${transactionSignature.substring(0, 8)}... = ${devStillHolding}`);
    } catch (error: any) {
      console.error(`❌ Failed to check and save dev_still_holding for ${transactionSignature}:`, error?.message || error);
      // Don't throw - this is a utility function that should fail gracefully
    }
  }

  /**
   * Add token to queue for info extraction
   */
  private extractAndQueueToken(tokenMint: string): void {
    console.log(`🪙 Adding token to queue: ${tokenMint.substring(0, 8)}...`);

    // Add to queue (non-blocking)
    tokenQueueService.addToken(tokenMint).catch(error => {
      console.error(`Failed to add token to queue: ${error.message}`);
    });
  }

  /**
   * Fetch creator token count from Solscan API and save to database
   */
  private async fetchAndSaveCreatorTokenCount(creatorAddress: string, tokenAddress: string): Promise<void> {
    try {
      const solscanApiKey = process.env.SOLSCAN_API_KEY;
      
      if (!solscanApiKey) {
        console.log(`⚠️ SOLSCAN_API_KEY not configured, skipping creator token count fetch`);
        return;
      }

      let allTokens: any[] = [];
      let page = 1;
      const pageSize = 100;
      let hasMore = true;

      // Fetch all pages until we get fewer items than page_size
      while (hasMore) {
        const url = `https://pro-api.solscan.io/v2.0/account/defi/activities?address=${creatorAddress}&activity_type[]=ACTIVITY_SPL_INIT_MINT&page=${page}&page_size=${pageSize}&sort_by=block_time&sort_order=desc`;
        
        const requestOptions: RequestInit = {
          method: 'GET',
          headers: {
            'token': solscanApiKey
          }
        };
        
        const response = await fetch(url, requestOptions);
        
        if (!response.ok) {
          throw new Error(`Solscan API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.success || !data.data) {
          throw new Error('Invalid response from Solscan API');
        }
        
        // Extract token addresses from the data
        const pageTokens = data.data
          .filter((activity: any) => activity.routers && activity.routers.token1)
          .map((activity: any) => activity.routers.token1);
        
        allTokens = allTokens.concat(pageTokens);
        
        // Check if we should continue fetching
        if (data.data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      }
      
      // Remove duplicates by token address
      const uniqueTokens = new Set<string>();
      allTokens.forEach(tokenAddress => {
        uniqueTokens.add(tokenAddress);
      });
      
      const tokenCount = uniqueTokens.size;
      console.log(`Token count = ${tokenCount}`)
      
      // Save to database
      await dbService.updateCreatorTokenCount(tokenAddress, creatorAddress, tokenCount);
      
      console.log(`✅ Fetched and saved creator token count: ${creatorAddress.substring(0, 8)}... has ${tokenCount} tokens`);
    } catch (error: any) {
      console.error(`❌ Failed to fetch creator token count for ${creatorAddress.substring(0, 8)}...:`, error?.message || error);
      // Don't throw - this is a non-critical operation
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
      // We need to parse the account data according to the IDL structure
      // For now, we'll use a simpler approach: fetch from a known API or parse the account
      // The base_mint is a pubkey (32 bytes) starting at offset 33
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

  /**
   * Handle transactions from streamer (PumpFun and PumpAmm only)
   */
  private handleTransaction(tx: ParsedTransaction): void {
    try {
      // Check if tracker is running
      if (!this.isRunning) {
        return;
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

        if (!result) {
          continue;
        }

        // For PumpFun transactions, extract bonding_curve from compiledInstructions
        // by matching the event's mint with the instruction's mint
        // and set it as pool if not already set
        if (result.platform === "PumpFun" && !result.pool) {
          const bondingCurve = extractBondingCurveForEvent(tx, event);
          if (bondingCurve) {
            result.pool = bondingCurve;
            console.log(`✅ Extracted bonding_curve (pool) for PumpFun: ${bondingCurve.substring(0, 8)}...`);
          } else {
            console.log(`⚠️ Could not extract bonding_curve from compiledInstructions for PumpFun transaction`);
          }
        }

        // Filter: Only process transactions for tracked wallet addresses
        // Check if the feePayer (user wallet) is in our tracked addresses
        if (this.addresses.length > 0 && result.feePayer) {
          if (!this.addresses.includes(result.feePayer)) {
            // Skip this transaction - wallet not being tracked
            continue;
          }
        } else if (this.addresses.length === 0) {
          // No addresses set, skip all transactions
          continue;
        }

        // Extract token address for buy/sell events
        let tokenAddress = (result.type?.toUpperCase() === 'BUY' || result.type?.toUpperCase() === 'SELL')
          ? this.extractTokenAddress(result)
          : null;

        // For PumpAmm & pumpfun events, fetch token mint from pool account if not available
        if ((result.type?.toUpperCase() === 'BUY' || result.type?.toUpperCase() === 'SELL') && 
            !tokenAddress && 
            (result.platform === "PumpFun Amm" || result.platform === "PumpFun") && 
            result.pool) {
          // Fetch token mint asynchronously
          this.fetchTokenMintFromPool(result.pool).then(mint => {
            if (mint) {
              // Update result with token mint
              const txType = result.type?.toUpperCase();
              if (txType === 'BUY') {
                result.mintTo = mint;
              } else if (txType === 'SELL') {
                result.mintFrom = mint;
              }
              
              // Process the transaction with the updated token address
              this.processEvent(result, signature || '', slot, createdAt);
            } else {
              console.log(`⚠️ Could not extract token address from PumpAmm pool: ${result.pool}`);
            }
          }).catch(error => {
            console.error(`Error fetching token mint from pool:`, error?.message || error);
          });
          
          // Skip processing for now, will be processed after token mint is fetched
          continue;
        }

        // Process the event
        this.processEvent(result, signature || '', slot, createdAt);
      }
    } catch (error: any) {
      console.error(`❌ Error handling transaction:`, error?.message || error);
    }
  }

  /**
   * Process an event (helper method)
   */
  private processEvent(
    result: any,
    signature: string,
    slot: number | undefined,
    createdAt: string | null
  ): void {
    const txType = result.type?.toUpperCase();
    const tokenAddress = (txType === 'BUY' || txType === 'SELL')
      ? this.extractTokenAddress(result)
      : null;

    if (!tokenAddress && (txType === 'BUY' || txType === 'SELL')) {
      console.log(`⚠️ Could not extract token address from ${result.platform} event`);
      return;
    }

    console.log(`📥 Streamer ${result.platform} ${result.type} transaction: ${signature?.substring(0, 8)}...`);

    // Process transaction asynchronously (non-blocking)
    // Run transaction processing and pool monitoring in parallel
    if (txType === 'BUY' || txType === 'SELL') {
      // Module 2: Pool monitoring (runs in parallel, only for BUY/SELL with pool address)
      if (tokenAddress && result.pool) {
        if (!this.poolMonitoringService) {
          console.log(`⚠️ Pool monitoring service not initialized yet, skipping pool monitoring for ${signature?.substring(0, 8)}...`);
        } else {
          const currentSlotStr = slot?.toString();
          this.processPoolMonitoring(result, tokenAddress, signature, txType, createdAt, currentSlotStr).catch(error => {
            console.error(`Error processing pool monitoring:`, error?.message || error);
          });
        }
      } else {
        if (!result.pool) {
          console.log(`⚠️ No pool address found in result for ${signature?.substring(0, 8)}... (platform: ${result.platform})`);
        }
      }

      // Module 1: Transaction data processing
      const currentSlotStr = slot?.toString();
      this.processTransaction(result, signature, currentSlotStr, createdAt).catch(error => {
        console.error(`Error processing transaction:`, error?.message || error);
      });
    }
  }

  /**
   * Start tracking transactions
   */
  async start(): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      return { success: false, message: "Tracker is already running" };
    }

    if (this.addresses.length === 0) {
      return { success: false, message: "No addresses to track. Add addresses before starting." };
    }

    // Initialize if not already initialized
    if (!this.streamerInitialized) {
      this.initialize();
    }

    if (!this.streamerInitialized) {
      return { success: false, message: "Failed to initialize streamer" };
    }

    // Ensure addresses are added to streamer
    if (this.streamerService) {
      try {
        const currentTracked = this.streamerService.getTrackedAddresses();
        const addressesToAdd = this.addresses.filter(addr => !currentTracked.includes(addr));
        
        if (addressesToAdd.length > 0) {
          this.streamerService.addAddresses(addressesToAdd);
        }
      } catch (error: any) {
        console.error('Failed to add addresses to streamer:', error?.message || error);
      }
    }

    this.isRunning = true;

    // Start token queue processor
    tokenQueueService.start();

    // Start streamer for PumpFun and PumpAmm
    if (this.streamerService) {
      try {
        this.streamerService.start();
        console.log("✅ Started streamer");
      } catch (error: any) {
        console.error('Failed to start streamer:', error?.message || error);
        this.isRunning = false;
        return { success: false, message: `Failed to start streamer: ${error?.message || error}` };
      }
    } else {
      this.isRunning = false;
      return { success: false, message: "Streamer service not initialized" };
    }

    console.log('🚀 '.repeat(30));
    console.log('STARTING TRANSACTION TRACKING');
    console.log('Tracking PumpFun and PumpAmm transactions for wallets:');
    this.addresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr}`);
    });
    console.log('🚀 '.repeat(30) + '\n');

    return { success: true, message: "Tracker started successfully" };
  }


  // get transaction data using fetch
  async getTransactionDetail(signature: string) {
    const response = await fetch(`https://pro-api.solscan.io/v2.0/transaction/detail${signature}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    return data;
  }

  /**
   * Stop tracking transactions
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    if (!this.isRunning) {
      return { success: false, message: "Tracker is not running" };
    }

    // Stop streamer
    if (this.streamerInitialized && this.streamerService) {
      try {
        this.streamerService.stop();
        console.log("✅ Stopped streamer");
      } catch (error: any) {
        console.error('Failed to stop streamer:', error?.message || error);
      }
    }

    // Stop token queue processor
    tokenQueueService.stop();

    // Cleanup pool monitoring service
    if (this.poolMonitoringService) {
      await this.poolMonitoringService.cleanup().catch(error => {
        console.error('Failed to cleanup pool monitoring service:', error);
      });
    }

    this.isRunning = false;

    return { success: true, message: "Tracker stopped successfully" };
  }

  /**
   * Analyze wallet - get SOL balance and token holdings using Shyft API
   */
  async analyzeWallet(walletAddress: string): Promise<any> {
    try {
      const shyftApiKey = process.env.SHYFT_API_KEY;

      if (!shyftApiKey) {
        throw new Error("SHYFT_API_KEY not found in environment variables");
      }

      // Fetch all tokens using Shyft API
      const headers = new Headers();
      headers.append("x-api-key", shyftApiKey);

      const requestOptions: RequestInit = {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
      };

      const response = await fetch(
        `https://api.shyft.to/sol/v1/wallet/all_tokens?network=mainnet-beta&wallet=${walletAddress}`,
        requestOptions
      );

      if (!response.ok) {
        throw new Error(`Shyft API error: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || "Failed to fetch wallet data");
      }

      // Separate SOL and other tokens
      let solBalance = 0;
      const tokens: any[] = [];

      if (data.result && Array.isArray(data.result)) {
        for (const token of data.result) {
          // Check if it's wrapped SOL (native SOL in token form)
          if (token.address === "So11111111111111111111111111111111111111112") {
            solBalance = token.balance;
          }

          // Add all tokens (including wrapped SOL) to the list
          if (token.balance > 0) {
            tokens.push({
              mint: token.address,
              amount: token.balance.toString(),
              decimals: token.info?.decimals || 0,
              name: token.info?.name || "Unknown Token",
              symbol: token.info?.symbol || "???",
              image: token.info?.image || null,
            });
          }
        }
      }

      // Also get native SOL balance
      if (this.solanaConnection) {
        const publicKey = new PublicKey(walletAddress);
        const nativeBalance = await this.solanaConnection.getBalance(publicKey);
        const nativeSol = nativeBalance / LAMPORTS_PER_SOL;

        // Add native SOL to total if we have it
        solBalance = nativeSol;
      }

      return {
        wallet: walletAddress,
        solBalance: solBalance.toString(),
        tokens,
      };
    } catch (error: any) {
      console.error("Error analyzing wallet:", error);
      throw new Error(`Failed to analyze wallet: ${error.message}`);
    }
  }
}

// Export singleton instance
export const tracker = new TransactionTracker();


