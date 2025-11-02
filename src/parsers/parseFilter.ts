import { detectSwapPlatform } from "../util";
import { parsePumpAmmTransaction } from "./pumpAmm";
import { parsePumpFunTransaction } from "./pumpFun";
import { parseRaydiumAmmTransaction } from "./raydiumAmm";
import { parseOrcaTransaction } from "./orca";
import { parseRaydiumCpmmTransaction } from "./raydiumCpmm";
import { parseRaydiumClmmTransaction } from "./raydiumClmm";
import { parseRaydiumLaunchPadTransaction } from "./raydiumLauchPad";
import { parseMeteorDlmmTransaction } from "./meteoraDlmm";
import { parseMeteoraDammV2Transaction } from "./meteoraDammV2";
import { parseMeteoraDBCTransaction } from "./meteoraDBC";

export function parseTransaction(transactionData: any) {
  try {
    // Get the transaction from the data
    const tx = transactionData?.transaction?.transaction;

    if (!tx) {
      return null;
    }

    // Detect which platform this transaction is for
    const platform = detectSwapPlatform(tx);

    if (!platform) {
      console.log("❌ No supported platform detected");
      return null;
    }

    console.log(`🔍 Detected platform: ${platform}`);

    // Route to the appropriate parser based on platform
    switch (platform) {
      case "PumpFun Amm":
        return parsePumpAmmTransaction(transactionData);

      case "PumpFun":
        return parsePumpFunTransaction(transactionData);

      case "RaydiumAmm":
        return parseRaydiumAmmTransaction(transactionData);

      case "RaydiumCpmm":
        return parseRaydiumCpmmTransaction(transactionData);

      case "RaydiumClmm":
        return parseRaydiumClmmTransaction(transactionData);

      case "RaydiumLaunchPad":
        return parseRaydiumLaunchPadTransaction(transactionData);

      case "Orca":
        return parseOrcaTransaction(transactionData);
        
      case "MeteoraDLMM":
        return parseMeteorDlmmTransaction(transactionData);

      case "MeteoraDammV2":
        return parseMeteoraDammV2Transaction(transactionData);
        
      case "MeteoraDBC":
        return parseMeteoraDBCTransaction(transactionData);

      default:
        console.log(`❌ Unknown platform: ${platform}`);
        return null;
    }
  } catch (error) {
    console.error("❌ Error in parseTransaction:", error);
    return null;
  }
}

