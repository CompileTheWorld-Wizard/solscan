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
 * Helper function to resolve account from index or string
 */
function resolveAccount(account: any, accountKeys: any[]): string | null {
  if (typeof account === 'string' && account.length > 0) {
    return account;
  }
  if (typeof account === 'number' && accountKeys.length > account) {
    const resolved = accountKeys[account];
    return typeof resolved === 'string' ? resolved : resolved?.pubkey || null;
  }
  return null;
}

/**
 * Extract all mint/bonding_curve pairs from compiledInstructions in a transaction
 * Looks for ALL instructions where data.name is "buy" or "sell"
 * In those instructions, accounts[2] is mint and accounts[3] is bonding_curve
 * Falls back to innerInstructions if compiledInstructions don't have data.name
 * 
 * @param tx - Transaction object that may contain compiledInstructions or innerInstructions
 * @returns Array of mint/bonding_curve pairs, or empty array if none found
 */
export function extractAllMintBondingCurvePairs(tx: any): MintBondingCurvePair[] {
  if (!tx) {
    return [];
  }
  
  try {
    const pairs: MintBondingCurvePair[] = [];
    
    // Cache transaction properties to avoid repeated lookups
    const txMessage = tx.transaction?.message || tx.message;
    const compiledInstructions = txMessage?.compiledInstructions || txMessage?.instructions;

    // First, try to extract from compiledInstructions
    if (Array.isArray(compiledInstructions) && compiledInstructions.length > 0) {
      // Optimize: Check programId first (faster check), then accounts
      for (let i = 0; i < compiledInstructions.length; i++) {
        const ix = compiledInstructions[i];
        
        // Fast path: Check programId first (most selective filter)
        if (ix.programId !== PUMP_FUN_PROGRAM_ID) {
          continue;
        }
        
        // Check accounts length
        const accounts = ix.accounts;
        if (!Array.isArray(accounts) || accounts.length < 4) {
          continue;
        }

        // Extract addresses (already validated length >= 4)
        const mint = accounts[2];
        const bondingCurve = accounts[3];
        
        // Try to get instruction name from data.name if available, otherwise use 'unknown'
        const dataName = ix.data?.name;
        const instructionName = dataName ? dataName.toLowerCase() : 'unknown';
        
        // Fast validation: check type and length
        if (typeof mint === 'string' && mint.length > 0 && 
            typeof bondingCurve === 'string' && bondingCurve.length > 0) {
          pairs.push({
            mint,
            bondingCurve,
            instructionName: instructionName
          });
        }
      }
    }

    // If no pairs found from compiledInstructions, try innerInstructions
    // In innerInstructions, data might be null, so we only check programId and accounts length
    // Structure: innerInstructions is an array of instruction objects directly
    // Each instruction has: outerIndex, programId (string), accounts (array of strings), data (string or null)
    if (pairs.length === 0) {
      const txMeta = tx.meta || tx.transaction?.meta;
      const innerInstructions = txMeta?.innerInstructions || tx.innerInstructions;
      
      if (!Array.isArray(innerInstructions) || innerInstructions.length === 0) {
        return pairs;
      }

      // Handle nested structure: innerInstructions can be array of arrays
      let instructionsToProcess: any[] = [];
      if (innerInstructions.length > 0 && Array.isArray(innerInstructions[0])) {
        // Nested structure: flatten it
        for (const innerGroup of innerInstructions) {
          if (Array.isArray(innerGroup)) {
            instructionsToProcess.push(...innerGroup);
          }
        }
      } else {
        // Flat structure
        instructionsToProcess = innerInstructions;
      }

      // Process innerInstructions directly (they're already an array of instructions)
      for (let i = 0; i < instructionsToProcess.length; i++) {
        const ix = instructionsToProcess[i];
        
        // Check if this is a PumpFun instruction (programId is a string address)
        if (ix.programId !== PUMP_FUN_PROGRAM_ID) {
          continue;
        }

        // Extract accounts array - should be array of string addresses
        const accounts = ix.accounts;
        if (!Array.isArray(accounts) || accounts.length < 4) {
          continue;
        }

        // accounts[2] is mint, accounts[3] is bonding_curve (both should be string addresses)
        const mint = accounts[2];
        const bondingCurve = accounts[3];

        // Validate addresses (should already be strings in innerInstructions)
        if (typeof mint === 'string' && mint.length > 0 && 
            typeof bondingCurve === 'string' && bondingCurve.length > 0) {
          pairs.push({
            mint,
            bondingCurve,
            instructionName: 'unknown' // Can't determine buy/sell from innerInstructions (data is null or base64)
          });
        }
      }
    }

    return pairs;
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error extracting mint-bonding_curve pairs from compiledInstructions:', errorMessage);
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    return [];
  }
}

/**
 * Match a parsed event with a mint/bonding_curve pair based on mint address or instruction name
 * Optimized with direct iteration for small arrays
 * 
 * @param event - Parsed event (TradeEvent, BuyEvent, or SellEvent)
 * @param pairs - Array of mint/bonding_curve pairs from compiledInstructions
 * @returns bonding_curve address if match found, null otherwise
 */
export function matchEventWithBondingCurve(event: any, pairs: MintBondingCurvePair[]): string | null {
  if (!event || !pairs || pairs.length === 0) {
    return null;
  }

  try {
    const eventName = event.name;

    // For TradeEvent: match by mint address
    if (eventName === "TradeEvent") {
      const eventMint = event.data?.mint;
      if (!eventMint) {
        return null;
      }

      // Find matching pair by mint address
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i].mint === eventMint) {
          return pairs[i].bondingCurve;
        }
      }
      return null;
    }

    // For BuyEvent: match by instruction name 'buy'
    if (eventName === "BuyEvent") {
      const eventMint = event.data?.mint;
      let firstBuyPair: MintBondingCurvePair | null = null;
      let mintMatch: MintBondingCurvePair | null = null;
      
      // Iterate once to find buy pairs
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i].instructionName === 'buy') {
          if (!firstBuyPair) {
            firstBuyPair = pairs[i];
          }
          // If we have a mint, try to match by mint
          if (eventMint && pairs[i].mint === eventMint) {
            mintMatch = pairs[i];
            break; // Found exact match, exit early
          }
        }
      }
      
      // Return mint match if found, otherwise first buy pair
      return mintMatch ? mintMatch.bondingCurve : (firstBuyPair ? firstBuyPair.bondingCurve : null);
    }

    // For SellEvent: match by instruction name 'sell'
    if (eventName === "SellEvent") {
      const eventMint = event.data?.mint;
      let firstSellPair: MintBondingCurvePair | null = null;
      let mintMatch: MintBondingCurvePair | null = null;
      
      // Iterate once to find sell pairs
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i].instructionName === 'sell') {
          if (!firstSellPair) {
            firstSellPair = pairs[i];
          }
          // If we have a mint, try to match by mint
          if (eventMint && pairs[i].mint === eventMint) {
            mintMatch = pairs[i];
            break; // Found exact match, exit early
          }
        }
      }
      
      // Return mint match if found, otherwise first sell pair
      return mintMatch ? mintMatch.bondingCurve : (firstSellPair ? firstSellPair.bondingCurve : null);
    }

    return null;
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error matching event with bonding_curve:', errorMessage);
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    return null;
  }
}

/**
 * Extract bonding_curve address for a specific event from compiledInstructions
 * This function combines extractAllMintBondingCurvePairs and matchEventWithBondingCurve
 * Optimized: Early exit if event is not TradeEvent
 * 
 * @param tx - Transaction object that may contain compiledInstructions
 * @param event - Parsed event to match with
 * @returns bonding_curve address or null if not found
 */
export function extractBondingCurveForEvent(tx: any, event: any): string | null {
  // Early exit for unsupported event types
  if (!event || (event.name !== "TradeEvent" && event.name !== "BuyEvent" && event.name !== "SellEvent")) {
    return null;
  }

  const pairs = extractAllMintBondingCurvePairs(tx);
  if (pairs.length === 0) {
    return null;
  }

  return matchEventWithBondingCurve(event, pairs);
}

