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
    console.log('[extractAllMintBondingCurvePairs] ❌ Transaction is null/undefined');
    return [];
  }
  
  try {
    const pairs: MintBondingCurvePair[] = [];
    
    // Cache transaction properties to avoid repeated lookups
    const txMessage = tx.transaction?.message || tx.message;
    const compiledInstructions = txMessage?.compiledInstructions || txMessage?.instructions;

    console.log('[extractAllMintBondingCurvePairs] 🔍 Starting extraction');
    console.log('[extractAllMintBondingCurvePairs] Transaction structure:', {
      hasTransaction: !!tx.transaction,
      hasMessage: !!txMessage,
      hasCompiledInstructions: Array.isArray(compiledInstructions),
      compiledInstructionsLength: Array.isArray(compiledInstructions) ? compiledInstructions.length : 0
    });

    // First, try to extract from compiledInstructions
    if (Array.isArray(compiledInstructions) && compiledInstructions.length > 0) {
      console.log(`[extractAllMintBondingCurvePairs] 📋 Found ${compiledInstructions.length} compiledInstructions, checking for PumpFun...`);
      
      let pumpFunInstructionsFound = 0;
      let pumpFunInstructionsWithValidAccounts = 0;
      // Optimize: Check programId first (faster check), then accounts
      for (let i = 0; i < compiledInstructions.length; i++) {
        const ix = compiledInstructions[i];
        
        // Fast path: Check programId first (most selective filter)
        if (ix.programId !== PUMP_FUN_PROGRAM_ID) {
          continue;
        }
        
        pumpFunInstructionsFound++;
        console.log(`[extractAllMintBondingCurvePairs] ✅ Found PumpFun instruction at index ${i}:`, {
          programId: ix.programId,
          hasAccounts: Array.isArray(ix.accounts),
          accountsLength: Array.isArray(ix.accounts) ? ix.accounts.length : 0,
          hasData: !!ix.data,
          dataName: ix.data?.name
        });
        
        // Check accounts length
        const accounts = ix.accounts;
        if (!Array.isArray(accounts) || accounts.length < 4) {
          console.log(`[extractAllMintBondingCurvePairs] ⚠️ PumpFun instruction at index ${i} has invalid accounts:`, {
            isArray: Array.isArray(accounts),
            length: Array.isArray(accounts) ? accounts.length : 'N/A'
          });
          continue;
        }
        
        pumpFunInstructionsWithValidAccounts++;
        console.log(`[extractAllMintBondingCurvePairs] ✅ PumpFun instruction at index ${i} has valid accounts (length ${accounts.length})`);

        // Extract addresses (already validated length >= 4)
        const mint = accounts[2];
        const bondingCurve = accounts[3];
        
        // Try to get instruction name from data.name if available, otherwise use 'unknown'
        const dataName = ix.data?.name;
        const instructionName = dataName ? dataName.toLowerCase() : 'unknown';
        
        console.log(`[extractAllMintBondingCurvePairs] 🔍 Extracting from instruction ${i}:`, {
          mint: typeof mint === 'string' ? `${mint.substring(0, 8)}...` : `[${typeof mint}]`,
          bondingCurve: typeof bondingCurve === 'string' ? `${bondingCurve.substring(0, 8)}...` : `[${typeof bondingCurve}]`,
          instructionName: instructionName
        });
        
        // Fast validation: check type and length
        if (typeof mint === 'string' && mint.length > 0 && 
            typeof bondingCurve === 'string' && bondingCurve.length > 0) {
          pairs.push({
            mint,
            bondingCurve,
            instructionName: instructionName
          });
          console.log(`[extractAllMintBondingCurvePairs] ✅ Successfully extracted pair from instruction ${i}:`, {
            mint: `${mint.substring(0, 8)}...`,
            bondingCurve: `${bondingCurve.substring(0, 8)}...`,
            instructionName: instructionName
          });
        } else {
          console.log(`[extractAllMintBondingCurvePairs] ⚠️ Invalid mint/bondingCurve types in instruction ${i}:`, {
            mintType: typeof mint,
            mintLength: typeof mint === 'string' ? mint.length : 'N/A',
            bondingCurveType: typeof bondingCurve,
            bondingCurveLength: typeof bondingCurve === 'string' ? bondingCurve.length : 'N/A'
          });
        }
      }
      
      console.log(`[extractAllMintBondingCurvePairs] 📊 CompiledInstructions summary:`, {
        totalInstructions: compiledInstructions.length,
        pumpFunInstructionsFound,
        pumpFunInstructionsWithValidAccounts,
        pairsExtracted: pairs.length
      });
    } else {
      console.log('[extractAllMintBondingCurvePairs] ⚠️ No compiledInstructions found or empty array');
    }

    // If no pairs found from compiledInstructions, try innerInstructions
    // In innerInstructions, data might be null, so we only check programId and accounts length
    // Structure: innerInstructions is an array of instruction objects directly
    // Each instruction has: outerIndex, programId (string), accounts (array of strings), data (string or null)
    if (pairs.length === 0) {
      console.log('[extractAllMintBondingCurvePairs] 🔄 No pairs from compiledInstructions, trying innerInstructions...');
      const txMeta = tx.meta || tx.transaction?.meta;
      const innerInstructions = txMeta?.innerInstructions || tx.innerInstructions;
      
      console.log('[extractAllMintBondingCurvePairs] InnerInstructions check:', {
        hasMeta: !!txMeta,
        hasInnerInstructions: Array.isArray(innerInstructions),
        innerInstructionsLength: Array.isArray(innerInstructions) ? innerInstructions.length : 0,
        innerInstructionsStructure: Array.isArray(innerInstructions) && innerInstructions.length > 0 
          ? (Array.isArray(innerInstructions[0]) ? 'nested array' : 'flat array') 
          : 'N/A'
      });
      
      if (!Array.isArray(innerInstructions) || innerInstructions.length === 0) {
        console.log('[extractAllMintBondingCurvePairs] ❌ No innerInstructions found');
        return pairs;
      }

      // Handle nested structure: innerInstructions can be array of arrays
      let instructionsToProcess: any[] = [];
      if (innerInstructions.length > 0 && Array.isArray(innerInstructions[0])) {
        // Nested structure: flatten it
        console.log('[extractAllMintBondingCurvePairs] 📦 InnerInstructions is nested array, flattening...');
        for (const innerGroup of innerInstructions) {
          if (Array.isArray(innerGroup)) {
            instructionsToProcess.push(...innerGroup);
          }
        }
      } else {
        // Flat structure
        instructionsToProcess = innerInstructions;
      }

      console.log(`[extractAllMintBondingCurvePairs] 🔍 Processing ${instructionsToProcess.length} inner instructions...`);

      // Process innerInstructions directly (they're already an array of instructions)
      let innerPumpFunFound = 0;
      for (let i = 0; i < instructionsToProcess.length; i++) {
        const ix = instructionsToProcess[i];
        
        // Check if this is a PumpFun instruction (programId is a string address)
        if (ix.programId !== PUMP_FUN_PROGRAM_ID) {
          continue;
        }

        innerPumpFunFound++;
        console.log(`[extractAllMintBondingCurvePairs] ✅ Found PumpFun innerInstruction at index ${i}:`, {
          programId: ix.programId,
          hasAccounts: Array.isArray(ix.accounts),
          accountsLength: Array.isArray(ix.accounts) ? ix.accounts.length : 0
        });

        // Extract accounts array - should be array of string addresses
        const accounts = ix.accounts;
        if (!Array.isArray(accounts) || accounts.length < 4) {
          console.log(`[extractAllMintBondingCurvePairs] ⚠️ InnerInstruction at index ${i} has invalid accounts`);
          continue;
        }

        // accounts[2] is mint, accounts[3] is bonding_curve (both should be string addresses)
        const mint = accounts[2];
        const bondingCurve = accounts[3];

        console.log(`[extractAllMintBondingCurvePairs] 🔍 Extracting from innerInstruction ${i}:`, {
          mint: typeof mint === 'string' ? `${mint.substring(0, 8)}...` : `[${typeof mint}]`,
          bondingCurve: typeof bondingCurve === 'string' ? `${bondingCurve.substring(0, 8)}...` : `[${typeof bondingCurve}]`
        });

        // Validate addresses (should already be strings in innerInstructions)
        if (typeof mint === 'string' && mint.length > 0 && 
            typeof bondingCurve === 'string' && bondingCurve.length > 0) {
          pairs.push({
            mint,
            bondingCurve,
            instructionName: 'unknown' // Can't determine buy/sell from innerInstructions (data is null or base64)
          });
          console.log(`[extractAllMintBondingCurvePairs] ✅ Successfully extracted pair from innerInstruction ${i}`);
        } else {
          console.log(`[extractAllMintBondingCurvePairs] ⚠️ Invalid mint/bondingCurve types in innerInstruction ${i}`);
        }
      }
      
      console.log(`[extractAllMintBondingCurvePairs] 📊 InnerInstructions summary:`, {
        totalInnerInstructions: instructionsToProcess.length,
        pumpFunInnerInstructionsFound: innerPumpFunFound,
        pairsExtracted: pairs.length
      });
    } else {
      console.log(`[extractAllMintBondingCurvePairs] ✅ Already found ${pairs.length} pairs from compiledInstructions, skipping innerInstructions`);
    }

    console.log(`[extractAllMintBondingCurvePairs] ✅ Final result: ${pairs.length} pair(s) extracted`);
    if (pairs.length > 0) {
      pairs.forEach((pair, idx) => {
        console.log(`[extractAllMintBondingCurvePairs]   Pair ${idx + 1}:`, {
          mint: `${pair.mint.substring(0, 8)}...`,
          bondingCurve: `${pair.bondingCurve.substring(0, 8)}...`,
          instructionName: pair.instructionName
        });
      });
    }
    return pairs;
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[extractAllMintBondingCurvePairs] ❌ Error extracting mint-bonding_curve pairs:', errorMessage);
    if (error instanceof Error && error.stack) {
      console.error('[extractAllMintBondingCurvePairs] Stack trace:', error.stack);
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
  console.log('[matchEventWithBondingCurve] 🔍 Starting matching...');
  console.log('[matchEventWithBondingCurve] Event:', {
    hasEvent: !!event,
    eventName: event?.name,
    eventMint: event?.data?.mint ? `${event.data.mint.substring(0, 8)}...` : 'N/A',
    pairsCount: pairs?.length || 0
  });

  if (!event || !pairs || pairs.length === 0) {
    console.log('[matchEventWithBondingCurve] ❌ Missing event or pairs');
    return null;
  }

  try {
    const eventName = event.name;
    console.log(`[matchEventWithBondingCurve] Event name: "${eventName}"`);

    // For TradeEvent: match by mint address
    if (eventName === "TradeEvent") {
      const eventMint = event.data?.mint;
      console.log(`[matchEventWithBondingCurve] TradeEvent - eventMint: ${eventMint ? `${eventMint.substring(0, 8)}...` : 'N/A'}`);
      if (!eventMint) {
        console.log('[matchEventWithBondingCurve] ❌ TradeEvent has no mint in data');
        return null;
      }

      // Find matching pair by mint address
      console.log(`[matchEventWithBondingCurve] Searching ${pairs.length} pairs for mint match...`);
      for (let i = 0; i < pairs.length; i++) {
        console.log(`[matchEventWithBondingCurve]   Comparing pair ${i + 1}:`, {
          pairMint: `${pairs[i].mint.substring(0, 8)}...`,
          eventMint: `${eventMint.substring(0, 8)}...`,
          match: pairs[i].mint === eventMint
        });
        if (pairs[i].mint === eventMint) {
          console.log(`[matchEventWithBondingCurve] ✅ Found matching mint in pair ${i + 1}, bondingCurve: ${pairs[i].bondingCurve.substring(0, 8)}...`);
          return pairs[i].bondingCurve;
        }
      }
      console.log('[matchEventWithBondingCurve] ❌ No matching mint found in pairs');
      return null;
    }

    // For BuyEvent: match by instruction name 'buy'
    if (eventName === "BuyEvent") {
      const eventMint = event.data?.mint;
      console.log(`[matchEventWithBondingCurve] BuyEvent - eventMint: ${eventMint ? `${eventMint.substring(0, 8)}...` : 'N/A'}`);
      let firstBuyPair: MintBondingCurvePair | null = null;
      let mintMatch: MintBondingCurvePair | null = null;
      
      console.log(`[matchEventWithBondingCurve] Searching ${pairs.length} pairs for 'buy' instruction...`);
      // Iterate once to find buy pairs
      for (let i = 0; i < pairs.length; i++) {
        console.log(`[matchEventWithBondingCurve]   Pair ${i + 1}:`, {
          instructionName: pairs[i].instructionName,
          pairMint: `${pairs[i].mint.substring(0, 8)}...`,
          isBuy: pairs[i].instructionName === 'buy'
        });
        if (pairs[i].instructionName === 'buy') {
          if (!firstBuyPair) {
            firstBuyPair = pairs[i];
            console.log(`[matchEventWithBondingCurve]   ✅ Found first buy pair at index ${i}`);
          }
          // If we have a mint, try to match by mint
          if (eventMint && pairs[i].mint === eventMint) {
            mintMatch = pairs[i];
            console.log(`[matchEventWithBondingCurve]   ✅ Found mint match at index ${i}`);
            break; // Found exact match, exit early
          }
        }
      }
      
      // Return mint match if found, otherwise first buy pair
      const result = mintMatch ? mintMatch.bondingCurve : (firstBuyPair ? firstBuyPair.bondingCurve : null);
      console.log(`[matchEventWithBondingCurve] ${result ? '✅' : '❌'} BuyEvent result:`, {
        found: !!result,
        bondingCurve: result ? `${result.substring(0, 8)}...` : 'N/A',
        matchedBy: mintMatch ? 'mint' : (firstBuyPair ? 'first buy pair' : 'none')
      });
      return result;
    }

    // For SellEvent: match by instruction name 'sell'
    if (eventName === "SellEvent") {
      const eventMint = event.data?.mint;
      console.log(`[matchEventWithBondingCurve] SellEvent - eventMint: ${eventMint ? `${eventMint.substring(0, 8)}...` : 'N/A'}`);
      let firstSellPair: MintBondingCurvePair | null = null;
      let mintMatch: MintBondingCurvePair | null = null;
      
      console.log(`[matchEventWithBondingCurve] Searching ${pairs.length} pairs for 'sell' instruction...`);
      // Iterate once to find sell pairs
      for (let i = 0; i < pairs.length; i++) {
        console.log(`[matchEventWithBondingCurve]   Pair ${i + 1}:`, {
          instructionName: pairs[i].instructionName,
          pairMint: `${pairs[i].mint.substring(0, 8)}...`,
          isSell: pairs[i].instructionName === 'sell'
        });
        if (pairs[i].instructionName === 'sell') {
          if (!firstSellPair) {
            firstSellPair = pairs[i];
            console.log(`[matchEventWithBondingCurve]   ✅ Found first sell pair at index ${i}`);
          }
          // If we have a mint, try to match by mint
          if (eventMint && pairs[i].mint === eventMint) {
            mintMatch = pairs[i];
            console.log(`[matchEventWithBondingCurve]   ✅ Found mint match at index ${i}`);
            break; // Found exact match, exit early
          }
        }
      }
      
      // Return mint match if found, otherwise first sell pair
      const result = mintMatch ? mintMatch.bondingCurve : (firstSellPair ? firstSellPair.bondingCurve : null);
      console.log(`[matchEventWithBondingCurve] ${result ? '✅' : '❌'} SellEvent result:`, {
        found: !!result,
        bondingCurve: result ? `${result.substring(0, 8)}...` : 'N/A',
        matchedBy: mintMatch ? 'mint' : (firstSellPair ? 'first sell pair' : 'none')
      });
      return result;
    }

    console.log(`[matchEventWithBondingCurve] ❌ Unknown event name: "${eventName}"`);
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
  console.log('[extractBondingCurveForEvent] 🚀 Starting extraction for event:', {
    eventName: event?.name,
    eventMint: event?.data?.mint ? `${event.data.mint.substring(0, 8)}...` : 'N/A',
    hasTransaction: !!tx
  });

  // Early exit for unsupported event types
  if (!event || (event.name !== "TradeEvent" && event.name !== "BuyEvent" && event.name !== "SellEvent")) {
    console.log('[extractBondingCurveForEvent] ❌ Unsupported event type:', event?.name);
    return null;
  }

  const pairs = extractAllMintBondingCurvePairs(tx);
  console.log(`[extractBondingCurveForEvent] 📊 Extracted ${pairs.length} pair(s) from transaction`);
  
  if (pairs.length === 0) {
    console.log('[extractBondingCurveForEvent] ❌ No pairs found, cannot match');
    return null;
  }

  const result = matchEventWithBondingCurve(event, pairs);
  console.log(`[extractBondingCurveForEvent] ${result ? '✅' : '❌'} Final result:`, {
    found: !!result,
    bondingCurve: result ? `${result.substring(0, 8)}...` : 'N/A'
  });
  return result;
}

