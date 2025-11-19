require("dotenv").config();
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { SubscribeRequest } from "@triton-one/yellowstone-grpc/dist/types/grpc/geyser";
import * as bs58 from "bs58";
import { parseTransaction } from "../parsers/parseFilter";
import { dbService } from "../database";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { tokenQueueService } from "../services/tokenQueueService";
import { walletTrackingService } from "../services/walletTrackingService";

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
    const shyftApiKey = process.env.SHYFT_API_KEY;
    const rpcUrl = `https://rpc.shyft.to/${shyftApiKey}`;
    this.solanaConnection = new Connection(rpcUrl, "confirmed");

    // Initialize wallet tracking service with Solana connection for pool monitoring
    walletTrackingService.initialize(this.solanaConnection).catch(error => {
      console.error('Failed to initialize wallet tracking service:', error);
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

        const tx = data.transaction?.transaction?.transaction;
        if (tx?.signatures?.[0]) {
          hasRcvdMSg = true;
          const sig = bs58.encode(tx.signatures[0]);
          console.log("Got tx:", sig, "slot:", currentSlot);

          const result = parseTransaction(data.transaction);

          // Save to database asynchronously (non-blocking)
          if (result) {
            // Convert slot to number for block_number
            const blockNumber = currentSlot ? parseInt(currentSlot, 10) : null;
            const blockNumberValue = (blockNumber !== null && !isNaN(blockNumber)) ? blockNumber : null;

            // Record current time when transaction is received (Unix epoch in seconds, UTC)
            const blockTimestamp = Math.floor(Date.now() / 1000);

            dbService.saveTransaction(sig, {
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
            });

            // Extract token from buy/sell events
            const txType = result.type?.toUpperCase();
            console.log(`📝 Transaction type: ${result.type} (normalized: ${txType})`);

            if (txType === 'BUY' || txType === 'SELL') {
              // Wrap in async IIFE to allow await
              (async () => {
                console.log(`✅ Processing ${result.type} transaction...`);

                // Extract token address once (used by both wallet tracking and token queue)
                const tokenAddress = this.extractTokenAddress(result);

                if (!tokenAddress) {
                  console.log(`⚠️ No valid token found in ${result.type} transaction (mintFrom: ${result.mintFrom?.substring(0, 8)}, mintTo: ${result.mintTo?.substring(0, 8)})`);
                  return;
                }

                console.log(`🔎 Token extracted: ${tokenAddress.substring(0, 8)}...`);

                // Handle buy/sell event flow:
                // 1. Get token price in SOL from parseTransaction result
                const tokenPriceSol = result.price ? parseFloat(result.price.toString()) : null;

                if (tokenPriceSol === null || isNaN(tokenPriceSol)) {
                  console.log(`⚠️ No valid price found in transaction result for ${sig}`);
                } else {
                  console.log(`💰 Token price in SOL: ${tokenPriceSol}`);

                  // 2. Fetch SOL price from database
                  const solPriceUsd = await dbService.getLatestSolPrice();
                  
                  if (!solPriceUsd) {
                    console.log(`⚠️ Failed to fetch SOL price from database for ${sig}`);
                  } else {
                    // 3. Calculate token price in USD
                    const tokenPriceUsd = tokenPriceSol * solPriceUsd;
                    console.log(`💵 Token price in USD: $${tokenPriceUsd}`);

                    // 4. Fetch total supply using web3.js
                    const supplyData = await this.getTokenTotalSupply(tokenAddress);
                    
                    if (supplyData) {
                      const { supply: totalSupply, decimals } = supplyData;
                      console.log(`📊 Total supply: ${totalSupply} (decimals: ${decimals})`);

                      // 5. Calculate market cap = total supply * token price in USD
                      const marketCap = totalSupply * tokenPriceUsd;
                      console.log(`🧮 MarketCap for ${sig}: $${marketCap}`);

                      // 6. Update database with market cap, total supply, and token prices
                      dbService.updateTransactionMarketCap(
                        sig, 
                        marketCap, 
                        totalSupply,
                        tokenPriceSol,
                        tokenPriceUsd
                      ).catch((e) => {
                        console.error(`Failed to persist market cap for ${sig}:`, e?.message || e);
                      });

                      // 7. Track wallet-token pair with market cap info
                      walletTrackingService.trackWalletToken(
                        result.feePayer,
                        tokenAddress,
                        result.in_amount?.toString() || '0',
                        result.out_amount?.toString() || '0',
                        result.type,
                        {
                          success: true,
                          marketCap,
                          tokenSupply: totalSupply,
                          tokenAddress,
                          price: tokenPriceUsd,
                          decimals: decimals
                        },
                        result.pool // Pass pool address for monitoring
                      ).catch(error => {
                        console.error(`Failed to track wallet-token pair: ${error.message}`);
                      });
                    } else {
                      console.log(`⚠️ Failed to fetch total supply for ${tokenAddress.substring(0, 8)}...`);
                      
                      // Still update token prices even if we can't get supply
                      dbService.updateTransactionMarketCap(
                        sig, 
                        null, 
                        null,
                        tokenPriceSol,
                        tokenPriceUsd
                      ).catch((e) => {
                        console.error(`Failed to persist token prices for ${sig}:`, e?.message || e);
                      });

                      // Track wallet without market cap (but with price)
                      walletTrackingService.trackWalletToken(
                        result.feePayer,
                        tokenAddress,
                        result.in_amount?.toString() || '0',
                        result.out_amount?.toString() || '0',
                        result.type,
                        {
                          success: false,
                          price: tokenPriceUsd,
                          // No marketCap, tokenSupply, or decimals available
                        },
                        result.pool // Pass pool address for monitoring
                      ).catch(error => {
                        console.error(`Failed to track wallet-token pair: ${error.message}`);
                      });
                    }
                  }
                }

                // 8. Add token to queue for info extraction
                this.extractAndQueueToken(tokenAddress);
              })().catch(error => {
                console.error(`Error processing buy/sell event:`, error?.message || error);
              });
            } else {
              console.log(`⏭️ Skipping - type is ${result.type}`);
            }
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
    console.log(data);
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
    await walletTrackingService.cleanup().catch(error => {
      console.error('Failed to cleanup pool monitoring service:', error);
    });

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


