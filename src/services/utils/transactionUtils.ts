/**
 * Utility functions for extracting data from transactions
 */

const PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/**
 * Interface for mint/bonding_curve pair from compiledInstructions
 */
export interface MintBondingCurvePair {
  mint: string;
  bondingCurve: string;
  instructionName: string; // 'buy' or 'sell'
}

/**
 * Extract all mint/bonding_curve pairs from compiledInstructions in a transaction
 * Looks for ALL instructions where data.name is "buy" or "sell"
 * In those instructions, accounts[2] is mint and accounts[3] is bonding_curve
 * 
 * @param tx - Transaction object that may contain compiledInstructions
 * @returns Array of mint/bonding_curve pairs, or empty array if none found
 */
export function extractAllMintBondingCurvePairs(tx: any): MintBondingCurvePair[] {
  try {
    // Check if compiledInstructions exists in various possible locations
    const compiledInstructions = 
      tx?.transaction?.message?.compiledInstructions ||
      tx?.message?.compiledInstructions ||
      tx?.compiledInstructions;

    if (!compiledInstructions || !Array.isArray(compiledInstructions)) {
      return [];
    }

    const pairs: MintBondingCurvePair[] = [];

    // Find ALL instructions where data.name is "buy" or "sell"
    for (const ix of compiledInstructions) {
      // Check if data exists and has name property
      if (!ix?.data?.name) {
        continue;
      }

      const name = ix.data.name.toLowerCase();
      if (name !== 'buy' && name !== 'sell') {
        continue;
      }

      // Check if this is a PumpFun instruction (programId should match)
      const programId = ix.programId;
      if (programId !== PUMP_FUN_PROGRAM_ID) {
        continue;
      }

      // Extract accounts array
      const accounts = ix.accounts;
      if (!accounts || !Array.isArray(accounts) || accounts.length < 4) {
        continue;
      }

      // accounts[2] is mint, accounts[3] is bonding_curve
      const mint = accounts[2];
      const bondingCurve = accounts[3];
      
      // Validate addresses
      if (typeof mint === 'string' && mint.length > 0 && 
          typeof bondingCurve === 'string' && bondingCurve.length > 0) {
        pairs.push({
          mint,
          bondingCurve,
          instructionName: name
        });
      }
    }

    return pairs;
  } catch (error: any) {
    console.error('Error extracting mint/bonding_curve pairs from compiledInstructions:', error?.message || error);
    return [];
  }
}

/**
 * Match a parsed event with a mint/bonding_curve pair based on mint address
 * 
 * @param event - Parsed event (TradeEvent, BuyEvent, or SellEvent)
 * @param pairs - Array of mint/bonding_curve pairs from compiledInstructions
 * @returns bonding_curve address if match found, null otherwise
 */
export function matchEventWithBondingCurve(event: any, pairs: MintBondingCurvePair[]): string | null {
  try {
    if (!event || !pairs || pairs.length === 0) {
      return null;
    }

    // Extract mint from event based on event type
    let eventMint: string | null = null;

    if (event.name === "TradeEvent" && event.data?.mint) {
      // PumpFun TradeEvent has mint in data
      eventMint = event.data.mint;
    } else if ((event.name === "BuyEvent" || event.name === "SellEvent") && event.data?.pool) {
      // PumpAmm events have pool, not mint directly
      // We can't match by mint for PumpAmm, so return null
      return null;
    }

    if (!eventMint) {
      return null;
    }

    // Find matching pair by mint address
    const matchingPair = pairs.find(pair => pair.mint === eventMint);
    
    if (matchingPair) {
      return matchingPair.bondingCurve;
    }

    return null;
  } catch (error: any) {
    console.error('Error matching event with bonding_curve:', error?.message || error);
    return null;
  }
}

/**
 * Extract bonding_curve address for a specific event from compiledInstructions
 * This function combines extractAllMintBondingCurvePairs and matchEventWithBondingCurve
 * 
 * @param tx - Transaction object that may contain compiledInstructions
 * @param event - Parsed event to match with
 * @returns bonding_curve address or null if not found
 */
export function extractBondingCurveForEvent(tx: any, event: any): string | null {
  const pairs = extractAllMintBondingCurvePairs(tx);
  return matchEventWithBondingCurve(event, pairs);
}

