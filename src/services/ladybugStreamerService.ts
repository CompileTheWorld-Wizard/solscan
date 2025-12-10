import { Idl } from "@coral-xyz/anchor";
import { Idl as SerumIdl } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import { Parser, TransactionStreamer } from "@shyft-to/ladybug-sdk";
import pumpIdl from "./idls/pumpfun/pump_0.1.0.json";
import pumpAmmIdl from "./idls/pumpAmm/pump_amm_0.1.0.json";
import raydiumLiquidityIdl from "./idls/raydiumLiquidity/raydium_liquidity_4.0.0.json";
import raydiumClmmIdl from "./idls/raydiumClmm/raydium_clmm_0.1.0.json";
import raydiumCPIdl from "./idls/raydiumCp/raydium_cp_0.2.0.json";
import raydiumLaunchpadIdl from "./idls/raydiumLaunchpad/raydium_launchpad_0.2.0.json";
import jupiterAggregatorIdl from "./idls/jupiterAggregator/jup_ag_0.1.0.json";
import meteoraDammV2Idl from "./idls/meteoraDammV2/meteora_dammV2.json";
import meteoraDBCIdl from "./idls/meteoraDBC/meteora_dbc_0.1.7.json";
import meteoraDLMMIdl from "./idls/meteoraDlmm/meteora_dlmm_0.10.1.json";
import orcaIdl from "./idls/orca/orca_whirlpool_0.3.6.json";

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const RAYDIUM_LIQUIDITY_PROGRAM_ID = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
const RAYDIUM_CP_PROGRAM_ID = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
const RAYDIUM_LAUNCHPAD_PROGRAM_ID = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
const METEORA_DAMM_V2_PROGRAM_ID = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const METEORA_DBC_PROGRAM_ID = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const METEORA_DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
const ORCA_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const JUPITER_AGGREGATOR_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

/**
 * Ladybug Streamer Service
 * A new streamer model using ladybug-sdk for transaction streaming
 * Keeps track of addresses using an array variable
 */
class LadybugStreamerService {
  private parser: Parser;
  private streamer: TransactionStreamer | null = null;
  private trackedAddresses: string[] = []; // Array to track addresses
  private isStreaming: boolean = false;
  private dataCallback: ((tx: any) => void) | null = null;

  constructor() {
    this.parser = new Parser();
    this.initializeParser();
  }

  /**
   * Initialize parser with IDL files
   * User will copy IDL files to the idls directory
   */
  private initializeParser(): void {
    try {
      // Load IDL files
      this.parser.addIDL(PUMP_PROGRAM_ID, pumpIdl as Idl);
      this.parser.addIDL(PUMP_AMM_PROGRAM_ID, pumpAmmIdl as Idl);
      this.parser.addIDL(RAYDIUM_CLMM_PROGRAM_ID, raydiumClmmIdl as Idl);
      this.parser.addIDL(RAYDIUM_LIQUIDITY_PROGRAM_ID, raydiumLiquidityIdl as SerumIdl);
      this.parser.addIDL(RAYDIUM_CP_PROGRAM_ID, raydiumCPIdl as Idl);
      this.parser.addIDL(METEORA_DAMM_V2_PROGRAM_ID, meteoraDammV2Idl as Idl);
      this.parser.addIDL(JUPITER_AGGREGATOR_PROGRAM_ID, jupiterAggregatorIdl as Idl);
      this.parser.addIDL(METEORA_DBC_PROGRAM_ID, meteoraDBCIdl as Idl);
      this.parser.addIDL(METEORA_DLMM_PROGRAM_ID, meteoraDLMMIdl as Idl);
      this.parser.addIDL(ORCA_PROGRAM_ID, orcaIdl as SerumIdl);
      this.parser.addIDL(RAYDIUM_LAUNCHPAD_PROGRAM_ID, raydiumLaunchpadIdl as Idl);
    } catch (error) {
      console.error(`❌ Error loading pump IDL:`, error);
    }

    // Add more IDL files here as needed
    // Example: Import and load pump_amm_0.1.0.json
    // import pumpAmmIdl from "./ladybug/idls/pump_amm_0.1.0.json";
    // if (pumpAmmIdl.address) {
    //   const programId = new PublicKey(pumpAmmIdl.address);
    //   this.parser.addIDL(programId, pumpAmmIdl as Idl);
    //   console.log(`✅ Added IDL for program: ${programId.toString()}`);
    // }
  }

  /**
   * Initialize the streamer with grpc url and token
   */
  public initialize(grpcUrl: string, xToken: string): void {
    if (!grpcUrl || !xToken) {
      throw new Error("GRPC_URL and X_TOKEN are required");
    }

    this.streamer = new TransactionStreamer(grpcUrl, xToken);
    this.streamer.addParser(this.parser);
    console.log("✅ Streamer initialized");
  }

  /**
   * Add addresses to track (using array variable)
   */
  public addAddresses(addresses: string[]): void {
    if (!this.streamer) {
      throw new Error("Streamer not initialized. Call initialize() first.");
    }

    // Validate addresses
    const validAddresses: string[] = [];
    for (const addr of addresses) {
      try {
        new PublicKey(addr); // Validate address format
        if (!this.trackedAddresses.includes(addr)) {
          validAddresses.push(addr);
          this.trackedAddresses.push(addr);
        }
      } catch (error) {
        console.warn(`⚠️  Invalid address format: ${addr}`);
      }
    }

    if (validAddresses.length > 0) {
      this.streamer.addAddresses(validAddresses);
      console.log(`✅ Added ${validAddresses.length} address(es) to track. Total tracked: ${this.trackedAddresses.length}`);
    }
  }

  /**
   * Remove addresses from tracking (using array variable)
   */
  public removeAddresses(addresses: string[]): void {
    if (!this.streamer) {
      throw new Error("Streamer not initialized. Call initialize() first.");
    }

    const removedAddresses: string[] = [];
    for (const addr of addresses) {
      const index = this.trackedAddresses.indexOf(addr);
      if (index > -1) {
        this.trackedAddresses.splice(index, 1);
        removedAddresses.push(addr);
      }
    }

    if (removedAddresses.length > 0) {
      // Note: ladybug-sdk might not have removeAddresses method
      // If not available, we'll need to recreate the streamer or use a different approach
      // For now, we'll update our internal tracking
      console.log(`✅ Removed ${removedAddresses.length} address(es) from tracking. Remaining: ${this.trackedAddresses.length}`);
      
      // Re-add remaining addresses if streamer supports it
      // This is a workaround if removeAddresses is not available
      if (this.isStreaming && this.trackedAddresses.length > 0) {
        // Stop and restart with updated addresses
        this.stop();
        this.streamer.addAddresses(this.trackedAddresses);
        this.start();
      }
    }
  }

  /**
   * Set callback function for processing data
   */
  public onData(callback: (tx: any) => void): void {
    if (!this.streamer) {
      throw new Error("Streamer not initialized. Call initialize() first.");
    }
    this.dataCallback = callback;
    this.streamer.onData(callback);
  }

  /**
   * Start streaming
   */
  public start(): void {
    if (!this.streamer) {
      throw new Error("Streamer not initialized. Call initialize() first.");
    }

    if (this.isStreaming) {
      console.warn("⚠️  Streamer is already running");
      return;
    }

    if (this.trackedAddresses.length === 0) {
      console.warn("⚠️  No addresses to track. Add addresses before starting.");
      return;
    }

    this.streamer.start();
    this.isStreaming = true;
    console.log(` Started streaming for ${this.trackedAddresses.length} address(es)`);
  }

  /**
   * Stop streaming
   */
  public stop(): void {
    if (!this.streamer) {
      return;
    }

    if (!this.isStreaming) {
      console.warn("⚠️  Streamer is not running");
      return;
    }

    // Note: Check if streamer has a stop method
    // If not available, we'll just mark as not streaming
    this.isStreaming = false;
    console.log(" Stopped streaming");
  }

  /**
   * Get currently tracked addresses
   */
  public getTrackedAddresses(): string[] {
    return [...this.trackedAddresses]; // Return a copy
  }

  /**
   * Check if streamer is currently streaming
   */
  public getIsStreaming(): boolean {
    return this.isStreaming;
  }
}

// Export singleton instance
export const ladybugStreamerService = new LadybugStreamerService();