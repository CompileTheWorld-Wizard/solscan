import dotenv from "dotenv";
import { ladybugStreamerService } from "./src/services/ladybugStreamerService";

// Load environment variables
dotenv.config();

/**
 * Test file for Ladybug Streamer Service
 * Tests the add/remove addresses functionality using array variable
 */
async function testLadybugStreamer() {
  console.log("🧪 Testing Ladybug Streamer Service\n");

  // Check environment variables
  const grpcUrl = process.env.GRPC_URL;
  const xToken = process.env.X_TOKEN;

  if (!grpcUrl || !xToken) {
    console.error("❌ Missing required environment variables:");
    console.error("   GRPC_URL:", grpcUrl ? "✅" : "❌");
    console.error("   X_TOKEN:", xToken ? "✅" : "❌");
    console.error("\nPlease set GRPC_URL and X_TOKEN in your .env file");
    process.exit(1);
  }

  try {
    // Initialize the streamer
    console.log("1️⃣  Initializing streamer...");
    ladybugStreamerService.initialize(grpcUrl, xToken);
    console.log("   ✅ Streamer initialized\n");

    // Test: Add addresses using array variable
    console.log("2️⃣  Testing addAddresses() with array variable...");
    const addressesToAdd = [
      // "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // Pump.fun program
      // "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // Pump Amm program
      // "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // RaydiumLiquidity Program
      // "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // RaydiumCpmm program
      // "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // RaydiumClmm program
      // "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", // RaydiumLaunchPad program
      "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // JupiterAggregator program
      // "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca program
      // "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", // MeteoraDammV2 program
      // "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", // MeteoraDBC program
      // "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // MeteoraDLMM program
    ];

    ladybugStreamerService.addAddresses(addressesToAdd);
    console.log(`   ✅ Added addresses: ${addressesToAdd.join(", ")}\n`);

    // Test: Get tracked addresses
    console.log("3️⃣  Testing getTrackedAddresses()...");
    const tracked = ladybugStreamerService.getTrackedAddresses();
    console.log(`   ✅ Currently tracking ${tracked.length} address(es):`);
    tracked.forEach((addr, index) => {
      console.log(`      ${index + 1}. ${addr}`);
    });
    console.log();

    // Test: Add more addresses
    console.log("4️⃣  Testing addAddresses() with additional addresses...");
    const additionalAddresses = [
      // Add more test addresses here
      // "AnotherAddressHere",
    ];

    if (additionalAddresses.length > 0) {
      ladybugStreamerService.addAddresses(additionalAddresses);
      console.log(`   ✅ Added ${additionalAddresses.length} more address(es)\n`);
    } else {
      console.log("   ⚠️  No additional addresses to add\n");
    }

    // Test: Remove addresses using array variable
    console.log("5️⃣  Testing removeAddresses() with array variable...");
    const addressesToRemove = [
      // Uncomment to test removal
      // "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    ];

    if (addressesToRemove.length > 0) {
      ladybugStreamerService.removeAddresses(addressesToRemove);
      console.log(`   ✅ Removed ${addressesToRemove.length} address(es)\n`);
    } else {
      console.log("   ⚠️  No addresses to remove (uncomment addressesToRemove to test)\n");
    }

    // Test: Set data callback
    console.log("6️⃣  Testing onData() callback...");
    ladybugStreamerService.onData((tx: any) => {
      console.log("\n📥 Received transaction:");
      if (tx?.transaction?.message?.events?.length > 0) {
        console.log(tx?.transaction?.signatures?.[0])
        // console.log(JSON.stringify(tx));
        console.log(JSON.stringify(tx?.transaction?.message?.events, null, 2));
      }
      
      // console.log(tx?.transaction?.signatures)
      // console.log(JSON.stringify(tx?.transaction?.message?.events, null, 2));
      // console.log(JSON.stringify(tx?.transaction?.message?.compiledInstructions, null, 2));
    });
    console.log("   ✅ Callback set\n");

    // Test: Start streaming
    console.log("7️⃣  Testing start()...");
    const trackedBeforeStart = ladybugStreamerService.getTrackedAddresses();
    if (trackedBeforeStart.length === 0) {
      console.log("   ⚠️  No addresses tracked. Cannot start streaming.");
      console.log("   💡 Add addresses first using addAddresses()\n");
    } else {
      ladybugStreamerService.start();
      console.log(`   ✅ Started streaming for ${trackedBeforeStart.length} address(es)\n`);

      // Check streaming status
      console.log("8️⃣  Checking streaming status...");
      const isStreaming = ladybugStreamerService.getIsStreaming();
      console.log(`   ✅ Streaming status: ${isStreaming ? "🟢 Active" : "🔴 Inactive"}\n`);

      // Keep the process running for a bit to receive transactions
      console.log("⏳ Streaming transactions for 30 seconds...");
      console.log("   (Press Ctrl+C to stop early)\n");

      await new Promise(resolve => setTimeout(resolve, 30000));

      // Test: Stop streaming
      console.log("\n9️⃣  Testing stop()...");
      ladybugStreamerService.stop();
      console.log("   ✅ Stopped streaming\n");
    }

    // Final status
    console.log("📊 Final Status:");
    console.log(`   Tracked addresses: ${ladybugStreamerService.getTrackedAddresses().length}`);
    console.log(`   Streaming: ${ladybugStreamerService.getIsStreaming() ? "Yes" : "No"}`);
    console.log("\n✅ All tests completed!");

  } catch (error: any) {
    console.error("\n❌ Error during testing:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
testLadybugStreamer().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

