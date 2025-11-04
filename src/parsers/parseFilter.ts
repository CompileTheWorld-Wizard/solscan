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
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

function extractFees(tx) {
  if (!tx || !tx.transaction?.message) return null;

  const { accountKeys, instructions = [] } = tx.transaction.message;
  const accountPubkeys = accountKeys.map(k => bs58.encode(k));
  const transfers = [];

  for (const ix of instructions) {
    // System program id
    const programId = typeof ix.programIdIndex === 'number'
      ? accountPubkeys[ix.programIdIndex]
      : (ix.programId?.toString?.() || null);

    if (programId === '11111111111111111111111111111111') {
      // Try base64 first; fallback to base58 if failed
      let data;
      try {
        data = Buffer.from(ix.data, 'base64');
      } catch {
        data = bs58.decode(ix.data);
      }

      // Ensure data length is enough for parsing instruction and lamports
      if (data.length >= 12) {
        const instr = data.readUInt32LE(0);
        if (instr === 2) { // transfer
          const lamports = Number(data.readBigUInt64LE(4));
          const fromIndex = ix.accounts[0];
          const toIndex = ix.accounts[1];
          const fromPubkey = accountPubkeys[fromIndex];
          const toPubkey = accountPubkeys[toIndex];
          transfers.push({ from: fromPubkey, to: toPubkey, lamports });
        }
      }
    }
  }

  if (transfers.length > 0) {
    console.log("Detected system program transfers:", transfers);
  }
  return transfers;
}

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
    extractFees(transactionData.transaction)

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

