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
  let priorityFee = null;
  let transactionFee = null;

  // Extract transaction fee from metadata (fee charged by Solana chain)
  // The fee is the actual lamports charged by Solana for processing the transaction
  if (tx.meta?.fee !== undefined && tx.meta.fee !== null) {
    transactionFee = typeof tx.meta.fee === 'number' ? tx.meta.fee : Number(tx.meta.fee);
  }

  // Compute Budget Program ID
  const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

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
    } else if (programId === COMPUTE_BUDGET_PROGRAM_ID) {
      // Extract priority fee from Compute Budget Program
      let data;
      try {
        data = Buffer.from(ix.data, 'base64');
      } catch {
        try {
          data = bs58.decode(ix.data);
        } catch {
          continue; // Skip if data cannot be decoded
        }
      }

      if (data.length === 0) {
        continue;
      }

      const instructionType = data[0];

      // SetComputeUnitPrice instruction is discriminator 3
      // Data format: [instruction_byte (3), micro_lamports_per_cu (u64)]
      if (instructionType === 3 && data.length >= 9) {
        // Read u64 value (micro-lamports per compute unit)
        const microLamportsPerCu = Number(data.readBigUInt64LE(1));
        priorityFee = microLamportsPerCu;
      }
    }
  }

  // Calculate tipAmount: sum of all transfer amounts (in lamports)
  const tipAmountLamports = transfers.reduce((sum, transfer) => sum + transfer.lamports, 0);

  // Calculate feeAmount: transactionFee + priorityFee (in lamports)
  // Note: priorityFee from SetComputeUnitPrice is a rate (micro-lamports per compute unit)
  // To get the actual priority fee amount, we'd need: priorityFeeRate * computeUnitsConsumed / 1000000
  // However, without compute units consumed, we'll use the rate value directly
  // transactionFee is already in lamports from meta.fee
  // priorityFee is in micro-lamports per CU, we'll convert to lamports for addition
  // (This is approximate - actual priority fee depends on compute units consumed)
  const priorityFeeInLamports = priorityFee !== null ? priorityFee / 1000000 : 0;
  const feeAmountLamports = (transactionFee || 0) + priorityFeeInLamports;

  // Convert lamports to SOL (1 SOL = 1,000,000,000 lamports)
  const LAMPORTS_PER_SOL = 1000000000;
  const tipAmount = tipAmountLamports / LAMPORTS_PER_SOL;
  const feeAmount = feeAmountLamports / LAMPORTS_PER_SOL;

  // if (transfers.length > 0) {
  //   console.log("Detected system program transfers:", transfers);
  //   console.log("Total tipAmount:", tipAmount, "SOL");
  // }
  
  // if (priorityFee !== null) {
  //   console.log("Detected priority fee:", priorityFee, "micro-lamports per CU");
  // }

  // if (transactionFee !== null) {
  //   console.log("Detected transaction fee:", transactionFee, "lamports");
  // }

  // if (feeAmount > 0) {
  //   console.log("Total feeAmount:", feeAmount, "SOL");
  // }

  return { tipAmount, feeAmount };
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
    const fees = extractFees(transactionData.transaction);

    // Route to the appropriate parser based on platform
    let result = null;
    switch (platform) {
      case "PumpFun Amm":
        result = parsePumpAmmTransaction(transactionData);
        break;

      case "PumpFun":
        result = parsePumpFunTransaction(transactionData);
        break;

      case "RaydiumAmm":
        result = parseRaydiumAmmTransaction(transactionData);
        break;

      case "RaydiumCpmm":
        result = parseRaydiumCpmmTransaction(transactionData);
        break;

      case "RaydiumClmm":
        result = parseRaydiumClmmTransaction(transactionData);
        break;

      case "RaydiumLaunchPad":
        result = parseRaydiumLaunchPadTransaction(transactionData);
        break;

      case "Orca":
        result = parseOrcaTransaction(transactionData);
        break;
        
      case "MeteoraDLMM":
        result = parseMeteorDlmmTransaction(transactionData);
        break;

      case "MeteoraDammV2":
        result = parseMeteoraDammV2Transaction(transactionData);
        break;
        
      case "MeteoraDBC":
        result = parseMeteoraDBCTransaction(transactionData);
        break;

      default:
        console.log(`❌ Unknown platform: ${platform}`);
        return null;
    }

    // Merge fees into the result if available
    if (result && fees) {
      result.tipAmount = fees.tipAmount || 0;
      result.feeAmount = fees.feeAmount || 0;
    }

    return result;



  } catch (error) {
    console.error("❌ Error in parseTransaction:", error);
    return null;
  }
}

