require("dotenv").config();
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { SubscribeRequest } from "@triton-one/yellowstone-grpc/dist/types/grpc/geyser";
import * as bs58 from "bs58";
import { parseTransaction } from "./src/parsers/parseFilter";

const RETRY_DELAY_MS = 1000;
const MAX_RETRY_WITH_LAST_SLOT = 5;
const MAX_TRANSACTIONS_TO_TEST = 10; // Limit for testing

type StreamResult = {
  lastSlot?: string;
  hasRcvdMSg: boolean;
};

class ParseFilterTester {
  private client: Client | null = null;
  private isRunning: boolean = false;
  private shouldStop: boolean = false;
  private currentStream: any = null;
  private transactionCount: number = 0;
  private successCount: number = 0;
  private failureCount: number = 0;
  private testAddresses: string[] = [];

  constructor() {
    // Default test addresses - can be overridden
    this.testAddresses = [
      // Add some known swap program addresses for testing
      // "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // RaydiumAmm
      // "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // RaydiumCpmm
      // "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // MeteoraDLMM
      // "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // RaydiumClmm
      // "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // PumpAmm
      "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // PumpFun
    ];
  }

  /**
   * Initialize the tester with GRPC client
   */
  initialize() {
    if (!process.env.GRPC_URL || !process.env.X_TOKEN) {
      throw new Error("Missing GRPC_URL or X_TOKEN environment variables");
    }

    const grpcUrl = process.env.GRPC_URL;
    const xToken = process.env.X_TOKEN;

    console.log(`🔗 Connecting to gRPC endpoint: ${grpcUrl.replace(/\/\/.*@/, '//***@')}`);
    
    this.client = new Client(grpcUrl, xToken, {
      "grpc.keepalive_permit_without_calls": 1,
      "grpc.keepalive_time_ms": 10000,
      "grpc.keepalive_timeout_ms": 1000,
      "grpc.default_compression_algorithm": 2,
    });

    console.log("✅ Tester initialized");
  }

  /**
   * Set test addresses to track
   */
  setTestAddresses(addresses: string[]) {
    this.testAddresses = addresses.filter(addr => addr.trim().length > 0);
    console.log('\n' + '='.repeat(60));
    console.log('📍 TEST ADDRESSES:');
    console.log('='.repeat(60));
    this.testAddresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr}`);
    });
    console.log('='.repeat(60) + '\n');
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
        if (this.shouldStop || this.transactionCount >= MAX_TRANSACTIONS_TO_TEST) {
          if (this.transactionCount >= MAX_TRANSACTIONS_TO_TEST) {
            console.log(`\n✅ Reached test limit of ${MAX_TRANSACTIONS_TO_TEST} transactions`);
            this.shouldStop = true;
          }
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
          this.transactionCount++;
          const sig = bs58.encode(tx.signatures[0]);
          
          console.log('\n' + '='.repeat(80));
          console.log(`📦 Transaction #${this.transactionCount}: ${sig}`);
          console.log(`📍 Slot: ${currentSlot}`);
          console.log('='.repeat(80));

          console.log(JSON.stringify(data))

          // Call parseTransaction - this is what we're testing!
          const result = parseTransaction(data.transaction);

          if (result) {
            this.successCount++;
            console.log('✅ Parse successful!');
            console.log('📊 Result:');
            console.log(JSON.stringify(result, null, 2));
          } else {
            this.failureCount++;
            console.log('❌ Parse returned null (no supported platform or parsing error)');
          }

          console.log(`\n📈 Stats: ${this.successCount} successful, ${this.failureCount} failed, ${this.transactionCount} total`);
        }
      });

      stream.on("error", (err) => {
        console.error("❌ Stream error:", err);
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
        console.error("Stream error, retrying in 1 second...", err);

        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

        lastSlot = err.lastSlot;
        if (err.hasRcvdMSg) retryCount = 0;

        if (lastSlot && retryCount < MAX_RETRY_WITH_LAST_SLOT) {
          console.log(
            `#${retryCount} retrying with last slot ${lastSlot}, remaining retries ${
              MAX_RETRY_WITH_LAST_SLOT - retryCount
            }`,
          );
          args.fromSlot = lastSlot;
          retryCount++;
        } else {
          console.log("Retrying from latest slot (no last slot available)");
          delete args.fromSlot;
          retryCount = 0;
          lastSlot = undefined;
        }
      }
    }

    console.log("\n🛑 Test stream stopped");
    this.printFinalStats();
  }

  /**
   * Print final statistics
   */
  private printFinalStats() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL TEST STATISTICS');
    console.log('='.repeat(80));
    console.log(`Total transactions processed: ${this.transactionCount}`);
    console.log(`✅ Successful parses: ${this.successCount}`);
    console.log(`❌ Failed parses: ${this.failureCount}`);
    if (this.transactionCount > 0) {
      const successRate = ((this.successCount / this.transactionCount) * 100).toFixed(2);
      console.log(`📈 Success rate: ${successRate}%`);
    }
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Start testing
   */
  async start(): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      return { success: false, message: "Tester is already running" };
    }

    if (this.testAddresses.length === 0) {
      return { success: false, message: "No addresses to test" };
    }

    if (!this.client) {
      this.initialize();
    }

    this.isRunning = true;
    this.shouldStop = false;
    this.transactionCount = 0;
    this.successCount = 0;
    this.failureCount = 0;

    console.log('🚀 '.repeat(30));
    console.log('STARTING PARSEFILTER TEST');
    console.log(`Will process up to ${MAX_TRANSACTIONS_TO_TEST} transactions`);
    console.log('Using test addresses:');
    this.testAddresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr}`);
    });
    console.log('🚀 '.repeat(30) + '\n');

    const req: SubscribeRequest = {
      accounts: {},
      slots: {},
      transactions: {
        targetWallet: {
          vote: false,
          failed: false,
          accountInclude: this.testAddresses,
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

    return { success: true, message: "Test started successfully" };
  }

  /**
   * Stop testing
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    if (!this.isRunning) {
      return { success: false, message: "Tester is not running" };
    }

    this.shouldStop = true;
    
    if (this.currentStream) {
      try {
        this.currentStream.end();
      } catch (error) {
        console.error("Error ending stream:", error);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    
    this.isRunning = false;
    return { success: true, message: "Test stopped successfully" };
  }
}

// Main execution
async function main() {
  const tester = new ParseFilterTester();

  // Allow custom addresses via command line arguments
  const args = process.argv.slice(2);
  if (args.length > 0) {
    tester.setTestAddresses(args);
  }

  try {
    await tester.start();

    // Set up graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n⚠️  Received SIGINT, stopping test...');
      await tester.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n\n⚠️  Received SIGTERM, stopping test...');
      await tester.stop();
      process.exit(0);
    });

  } catch (error: any) {
    console.error("❌ Error starting test:", error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { ParseFilterTester };

