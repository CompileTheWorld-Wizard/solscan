require("dotenv").config();
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { SubscribeRequest } from "@triton-one/yellowstone-grpc/dist/types/grpc/geyser";
import * as bs58 from "bs58";
import { parseTransaction } from "../parsers/parseFilter";
import { dbService } from "../database";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { tokenQueueService } from "../services/tokenQueueService";
import { PoolMonitoringService } from "../services/poolMonitoringService";

const RETRY_DELAY_MS = 1000
const MAX_RETRY_WITH_LAST_SLOT = 5

type StreamResult = {
  lastSlot?: string;
  hasRcvdMSg: boolean;
};

class TransactionTracker {
  private client: Client | null = null;
  private isRunning: boolean = false;
  private shouldStop: boolean = false;
  private addresses: string[] = [];
  private currentStream: any = null;
  private solanaConnection: Connection | null = null;
  private poolMonitoringService: PoolMonitoringService | null = null;

  constructor() {
    // Initialize with empty addresses
  }

  /**
   * Initialize the tracker with GRPC client
   */
  initialize() {
    if (!process.env.GRPC_URL || !process.env.X_TOKEN) {
      throw new Error("Missing GRPC_URL or X_TOKEN environment variables");
    }

    const grpcUrl = process.env.GRPC_URL;
    const xToken = process.env.X_TOKEN;

    console.log(`🔗 Connecting to gRPC endpoint: ${grpcUrl.replace(/\/\/.*@/, '//***@')}`); // Hide credentials in URL

    this.client = new Client(grpcUrl, xToken, {
      "grpc.keepalive_permit_without_calls": 1,
      "grpc.keepalive_time_ms": 10000,
      "grpc.keepalive_timeout_ms": 1000,
      "grpc.default_compression_algorithm": 2,
      // "grpc.max_receive_message_length": 1024*1024*1024
    });

    // Initialize Solana RPC connection for wallet analysis
    const shyftApiKey = process.env.X_TOKEN;
    const rpcUrl = `https://dillwifit.shyft.to/${shyftApiKey}`;
    this.solanaConnection = new Connection(rpcUrl, "confirmed");

    // Initialize pool monitoring service
    PoolMonitoringService.getInstance(this.solanaConnection).then(service => {
      this.poolMonitoringService = service;
    }).catch(error => {
      console.error('Failed to initialize pool monitoring service:', error);
    });

    console.log("✅ Tracker initialized");
  }

  /**
   * Set addresses to track (from web interface inputs)
   */
  setAddresses(addresses: string[]) {
    this.addresses = addresses.filter(addr => addr.trim().length > 0);
    console.log('='.repeat(60));
    console.log('📍 ADDRESSES SET FROM WEB INTERFACE:');
    console.log('='.repeat(60));
    this.addresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr}`);
    });
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Get current addresses
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
   * Handle the stream
   */
  private async handleStream(
    args: SubscribeRequest,
    lastSlot?: string
  ): Promise<StreamResult> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    const stream = await this.client.subscribe();
    this.currentStream = stream;
    let hasRcvdMSg = false;
    let currentSlot = lastSlot;

    return new Promise((resolve, reject) => {
      stream.on("data", (data) => {
        // Check if we should stop
        if (this.shouldStop) {
          stream.end();
          return;
        }

        // Update lastSlot from the data
        if (data.transaction?.slot) {
          currentSlot = data.transaction.slot.toString();
        }

        // Extract createdAt timestamp from stream data (slot timestamp)
        const createdAt = data.createdAt || null;

        const tx = data.transaction?.transaction?.transaction;
        if (tx?.signatures?.[0]) {
          hasRcvdMSg = true;
          const sig = bs58.encode(tx.signatures[0]);
          console.log("Got tx:", sig, "slot:", currentSlot);

          const result = parseTransaction(data.transaction);

          // Process transaction asynchronously (non-blocking)
          if (result) {
            // Run transaction processing and pool monitoring in parallel
            const txType = result.type?.toUpperCase();
            const tokenAddress = (txType === 'BUY' || txType === 'SELL') 
              ? this.extractTokenAddress(result) 
              : null;

            // Module 2: Pool monitoring (runs in parallel, only for BUY/SELL with pool address)
            if ((txType === 'BUY' || txType === 'SELL') && tokenAddress && result.pool && this.poolMonitoringService) {
              this.processPoolMonitoring(result, tokenAddress, sig, txType, createdAt, currentSlot).catch(error => {
                console.error(`Error processing pool monitoring:`, error?.message || error);
              });
            }

            // Module 1: Transaction data processing (save transaction, check dev still holding, calculate market cap, check/register first_buy or first_sell)
            this.processTransaction(result, sig, currentSlot, createdAt).catch(error => {
              console.error(`Error processing transaction:`, error?.message || error);
            });
          }
        }
      });

      stream.on("error", (err) => {
        stream.end();
        reject({ error: err, lastSlot: currentSlot, hasRcvdMSg });
      });

      const finalize = () => resolve({ lastSlot: currentSlot, hasRcvdMSg });
      stream.on("end", finalize);
      stream.on("close", finalize);

      stream.write(args, (err: any) => {
        if (err) reject({ error: err, lastSlot: currentSlot, hasRcvdMSg });
      });
    });
  }

  /**
   * Subscribe to the stream
   */
  private async subscribeCommand(args: SubscribeRequest) {
    let lastSlot: string | undefined;
    let retryCount = 0;

    while (this.isRunning && !this.shouldStop) {
      try {
        if (args.fromSlot) {
          console.log("Starting stream from slot", args.fromSlot);
        }

        const result = await this.handleStream(args, lastSlot);
        lastSlot = result.lastSlot;

        // If we finished normally and should stop, break the loop
        if (this.shouldStop) {
          break;
        }
      } catch (err: any) {
        // If we should stop, break the loop
        if (this.shouldStop) {
          break;
        }
        console.log(err)
        console.error(
          `Stream error, retrying in ${RETRY_DELAY_MS} second...`,
        );

        //in case the stream is interrupted, it waits for a while before retrying
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

        lastSlot = err.lastSlot;
        if (err.hasRcvdMSg) retryCount = 0;

        if (lastSlot && retryCount < MAX_RETRY_WITH_LAST_SLOT) {
          console.log(
            `#${retryCount} retrying with last slot ${lastSlot}, remaining retries ${MAX_RETRY_WITH_LAST_SLOT - retryCount
            }`,
          );
          // sets the fromSlot to the last slot received before the stream was interrupted, if it exists
          args.fromSlot = lastSlot;
          retryCount++;
        } else {
          //when there is no last slot available, it starts the stream from the latest slot
          console.log("Retrying from latest slot (no last slot available)");
          delete args.fromSlot;
          retryCount = 0;
          lastSlot = undefined;
        }
      }
    }

    console.log("🛑 Tracker stopped");
  }

  /**
   * Process transaction asynchronously - Module 1: Transaction data processing
   * Handles: save transaction, check dev still holding, calculate market cap/token price, check/register first_buy or first_sell
   * Note: Pool monitoring (Module 2) runs in parallel separately in handleStream
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
        const marketCapData = await this.calculateMarketCapData(signature, tokenPriceSol, tokenAddress);

        // Update transaction with market cap data
        if (marketCapData) {
          await dbService.updateTransactionMarketCap(
            signature,
            marketCapData.marketCap,
            marketCapData.totalSupply,
            tokenPriceSol,
            marketCapData.tokenPriceUsd
          );
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
   */
  private async calculateMarketCapData(
    transactionId: string,
    tokenPriceSol: number,
    tokenAddress: string
  ): Promise<{ marketCap: number | null; totalSupply: number | null; tokenPriceUsd: number | null } | null> {
    try {
      // Get SOL price from database
      const solPriceUsd = await dbService.getLatestSolPrice();
      if (!solPriceUsd) {
        console.error(`Failed to fetch SOL price from database`);
        return null;
      }

      // Calculate token price in USD
      const tokenPriceUsd = tokenPriceSol * solPriceUsd;

      // Get token total supply
      const supplyData = await this.getTokenTotalSupply(tokenAddress);

      let marketCap: number | null = null;
      let totalSupply: number | null = null;

      if (supplyData) {
        totalSupply = supplyData.supply;
        // Calculate market cap = total supply * token price in USD
        marketCap = totalSupply * tokenPriceUsd;
      }

      return { marketCap, totalSupply, tokenPriceUsd };
    } catch (error: any) {
      console.error(`Failed to calculate market cap data for ${transactionId}:`, error?.message || error);
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
        marketData = {
          market_cap: marketCapData.marketCap,
          supply: marketCapData.totalSupply ? marketCapData.totalSupply.toString() : null,
          price: marketCapData.tokenPriceUsd,
          decimals: null // Will be set from token supply data if available
        };

        // Get decimals from token supply if available
        if (tokenAddress) {
          const supplyData = await this.getTokenTotalSupply(tokenAddress);
          if (supplyData) {
            marketData.decimals = supplyData.decimals;
          }
        }
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
              const solPriceUsd = await dbService.getLatestSolPrice();
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
            const solPriceUsd = await dbService.getLatestSolPrice();
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
      console.error('❌ Solana connection not initialized');
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
      const supply = rawSupply / Math.pow(10, decimals);

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
   * Start tracking transactions
   */
  async start(): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      return { success: false, message: "Tracker is already running" };
    }

    if (this.addresses.length === 0) {
      return { success: false, message: "No addresses to track" };
    }

    if (!this.client) {
      this.initialize();
    }

    // Ensure any previous stream is completely closed
    if (this.currentStream) {
      try {
        this.currentStream.end();
        this.currentStream = null;
      } catch (error) {
        // Ignore errors
      }
      // Wait for stream to fully close
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    this.isRunning = true;
    this.shouldStop = false;

    // Start token queue processor
    tokenQueueService.start();

    console.log('🚀 '.repeat(30));
    console.log('STARTING TRANSACTION TRACKING');
    console.log('Using addresses from web interface inputs:');
    this.addresses.forEach((addr, index) => {
      console.log(`   Input ${index + 1}: ${addr}`);
    });
    console.log('🚀 '.repeat(30) + '\n');

    const req: SubscribeRequest = {
      accounts: {},
      slots: {},
      transactions: {
        targetWallet: {
          vote: false,
          failed: false,
          accountInclude: this.addresses, // ← Addresses from web interface inputs!
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
    };

    // Start streaming in the background
    this.subscribeCommand(req).then(() => {
      this.isRunning = false;
    });

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

    this.shouldStop = true;

    // Stop token queue processor
    tokenQueueService.stop();

    // Cleanup pool monitoring service
    if (this.poolMonitoringService) {
      await this.poolMonitoringService.cleanup().catch(error => {
        console.error('Failed to cleanup pool monitoring service:', error);
      });
    }

    // Clear old subscription by sending empty subscription request before ending stream
    if (this.currentStream) {
      try {
        // Send empty subscription to clear old addresses from server
        const emptyReq: SubscribeRequest = {
          slots: {},
          accounts: {},
          transactions: {},
          blocks: {},
          blocksMeta: {},
          accountsDataSlice: [],
          transactionsStatus: {},
          entry: {}
        };

        // Send empty subscription to clear old subscription
        await new Promise<void>((resolve) => {
          try {
            this.currentStream.write(emptyReq, (err: any) => {
              if (err) {
                console.error("Error sending empty subscription:", err);
              } else {
                console.log("✅ Sent empty subscription to clear old addresses");
              }
              resolve();
            });
          } catch (error) {
            console.error("Error writing empty subscription:", error);
            resolve();
          }
        });

        // Wait a bit for the empty subscription to be processed
        await new Promise(resolve => setTimeout(resolve, 200));

        // Now end the stream
        this.currentStream.end();
      } catch (error) {
        console.error("Error ending stream:", error);
      }
    }

    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

    // Clear stream reference
    this.currentStream = null;
    this.isRunning = false;

    // Clear addresses to ensure fresh start next time
    this.addresses = [];

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


