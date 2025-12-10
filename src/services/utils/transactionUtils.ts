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
 * Falls back to innerInstructions if compiledInstructions don't have data.name
 * 
 * @param tx - Transaction object that may contain compiledInstructions or innerInstructions
 * @returns Array of mint/bonding_curve pairs, or empty array if none found
 */
export function extractAllMintBondingCurvePairs(tx: any): MintBondingCurvePair[] {
  try {
    const pairs: MintBondingCurvePair[] = [];

    // First, try to extract from compiledInstructions (with data.name)
    const compiledInstructions = 
      tx?.transaction?.message?.compiledInstructions ||
      tx?.message?.compiledInstructions ||
      tx?.compiledInstructions;

    if (compiledInstructions && Array.isArray(compiledInstructions)) {
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
    }

    // If no pairs found from compiledInstructions, try innerInstructions
    // In innerInstructions, data might be null, so we only check programId and accounts length
    if (pairs.length === 0) {
      const innerInstructions = 
        tx?.meta?.innerInstructions ||
        tx?.transaction?.meta?.innerInstructions ||
        tx?.innerInstructions;

      // Get accountKeys for resolving indices (if needed)
      const accountKeys = 
        tx?.transaction?.message?.accountKeys ||
        tx?.message?.accountKeys ||
        tx?.accountKeys ||
        [];

      if (innerInstructions && Array.isArray(innerInstructions)) {
        // innerInstructions is an array of objects with 'instructions' property
        // or an array of instruction arrays
        const flattenedInstructions: any[] = [];
        for (const innerIxGroup of innerInstructions) {
          if (innerIxGroup?.instructions && Array.isArray(innerIxGroup.instructions)) {
            flattenedInstructions.push(...innerIxGroup.instructions);
          } else if (Array.isArray(innerIxGroup)) {
            // Handle case where innerInstructions is already flattened
            flattenedInstructions.push(...innerIxGroup);
          }
        }

        for (const ix of flattenedInstructions) {
          // Check if this is a PumpFun instruction
          // programId might be a string address or an index (programIdIndex)
          let programId: string | null = null;
          
          if (ix.programId) {
            // If programId is already a string address
            programId = ix.programId;
          } else if (typeof ix.programIdIndex === 'number' && accountKeys.length > ix.programIdIndex) {
            // If programIdIndex exists, resolve from accountKeys
            const resolvedProgramId = accountKeys[ix.programIdIndex];
            if (typeof resolvedProgramId === 'string') {
              programId = resolvedProgramId;
            } else if (resolvedProgramId?.pubkey) {
              programId = resolvedProgramId.pubkey;
            }
          }

          if (!programId || programId !== PUMP_FUN_PROGRAM_ID) {
            continue;
          }

          // Extract accounts array - might be indices or addresses
          const accounts = ix.accounts;
          if (!accounts || !Array.isArray(accounts) || accounts.length < 4) {
            continue;
          }

          // Resolve account addresses if they're indices
          let mint: string | null = null;
          let bondingCurve: string | null = null;

          const mintIndex = accounts[2];
          const bondingCurveIndex = accounts[3];

          // Resolve mint
          if (typeof mintIndex === 'string' && mintIndex.length > 0) {
            mint = mintIndex; // Already an address
          } else if (typeof mintIndex === 'number' && accountKeys.length > mintIndex) {
            const resolvedMint = accountKeys[mintIndex];
            if (typeof resolvedMint === 'string') {
              mint = resolvedMint;
            } else if (resolvedMint?.pubkey) {
              mint = resolvedMint.pubkey;
            }
          }

          // Resolve bondingCurve
          if (typeof bondingCurveIndex === 'string' && bondingCurveIndex.length > 0) {
            bondingCurve = bondingCurveIndex; // Already an address
          } else if (typeof bondingCurveIndex === 'number' && accountKeys.length > bondingCurveIndex) {
            const resolvedBondingCurve = accountKeys[bondingCurveIndex];
            if (typeof resolvedBondingCurve === 'string') {
              bondingCurve = resolvedBondingCurve;
            } else if (resolvedBondingCurve?.pubkey) {
              bondingCurve = resolvedBondingCurve.pubkey;
            }
          }

          // Validate addresses
          if (mint && bondingCurve) {
            // Since we can't determine buy/sell from innerInstructions (data is null),
            // we'll use 'unknown' and let the caller handle it
            pairs.push({
              mint,
              bondingCurve,
              instructionName: 'unknown' // Can't determine from innerInstructions
            });
          }
        }
      }
    }

    return pairs;
  } catch (error: any) {
    console.error('Error extracting mint-bonding_curve pairs from compiledInstructions:', error?.message || error);
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

