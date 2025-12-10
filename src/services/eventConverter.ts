import {
  PumpFunTradeEvent,
  PumpAmmBuyEvent,
  PumpAmmSellEvent,
  ParsedEvent,
} from "./type";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_DECIMALS = 1_000_000; // PumpFun and PumpAmm tokens use 6 decimals

/**
 * Convert PumpFun TradeEvent to tracker format
 */
function convertPumpFunEvent(event: PumpFunTradeEvent): any {
  const { data } = event;
  
  // Calculate price using liquidity reserves (virtual reserves)
  // virtual_sol_reserves is in lamports (1 SOL = 1,000,000,000 lamports)
  // virtual_token_reserves is in base units with 6 decimals (1 token = 1,000,000 base units)
  const virtualSolReserves = data.virtual_sol_reserves / LAMPORTS_PER_SOL; // Convert lamports to SOL
  const virtualTokenReserves = data.virtual_token_reserves / TOKEN_DECIMALS; // Convert base units to human-readable tokens
  
  // Price = SOL per token (using liquidity reserves)
  const price = virtualTokenReserves > 0 ? virtualSolReserves / virtualTokenReserves : 0;
  
  return {
    platform: "PumpFun",
    type: data.is_buy ? "buy" : "sell",
    creator: data.creator,
    feePayer: data.user,
    mintFrom: data.is_buy ? SOL_MINT : data.mint,
    mintTo: data.is_buy ? data.mint : SOL_MINT,
    in_amount: data.is_buy ? data.sol_amount : data.token_amount,
    out_amount: data.is_buy ? data.token_amount : data.sol_amount,
    price: price,
    pool: null, // PumpFun doesn't have a pool address in the event
  };
}

/**
 * Convert PumpAmm BuyEvent to tracker format
 */
function convertPumpAmmBuyEvent(event: PumpAmmBuyEvent): any {
  const { data } = event;
  
  // Calculate price using pool liquidity reserves
  // pool_quote_token_reserves (SOL) is in lamports (1 SOL = 1,000,000,000 lamports)
  // pool_base_token_reserves (tokens) is in base units with 6 decimals (1 token = 1,000,000 base units)
  const poolSolReserves = data.pool_quote_token_reserves / LAMPORTS_PER_SOL; // Convert lamports to SOL
  const poolTokenReserves = data.pool_base_token_reserves / TOKEN_DECIMALS; // Convert base units to human-readable tokens
  
  // Price = SOL per token (using pool liquidity reserves)
  const price = poolTokenReserves > 0 ? poolSolReserves / poolTokenReserves : 0;
  
  return {
    platform: "PumpFun Amm", // Note: keeping the same platform name as existing parser
    type: "buy",
    creator: data.coin_creator,
    feePayer: data.user,
    mintFrom: SOL_MINT,
    mintTo: null, // We need to extract token mint from pool or other sources
    in_amount: data.quote_amount_in,
    out_amount: data.base_amount_out,
    price: price,
    pool: data.pool,
  };
}

/**
 * Convert PumpAmm SellEvent to tracker format
 */
function convertPumpAmmSellEvent(event: PumpAmmSellEvent): any {
  const { data } = event;
  
  // Calculate price using pool liquidity reserves
  // pool_quote_token_reserves (SOL) is in lamports (1 SOL = 1,000,000,000 lamports)
  // pool_base_token_reserves (tokens) is in base units with 6 decimals (1 token = 1,000,000 base units)
  const poolSolReserves = data.pool_quote_token_reserves / LAMPORTS_PER_SOL; // Convert lamports to SOL
  const poolTokenReserves = data.pool_base_token_reserves / TOKEN_DECIMALS; // Convert base units to human-readable tokens
  
  // Price = SOL per token (using pool liquidity reserves)
  const price = poolTokenReserves > 0 ? poolSolReserves / poolTokenReserves : 0;
  
  return {
    platform: "PumpFun Amm", // Note: keeping the same platform name as existing parser
    type: "sell",
    creator: data.coin_creator,
    feePayer: data.user,
    mintFrom: null, // We need to extract token mint from pool or other sources
    mintTo: SOL_MINT,
    in_amount: data.base_amount_in,
    out_amount: data.quote_amount_out,
    price: price,
    pool: data.pool,
  };
}

/**
 * Convert ladybug event to tracker format
 * Returns null if event is not supported or cannot be converted
 */
export function convertEventToTrackerFormat(
  event: ParsedEvent,
  transactionSignature?: string,
  slot?: number,
  createdAt?: string
): any | null {
  try {
    let result: any = null;
    
    if (event.name === "TradeEvent") {
      result = convertPumpFunEvent(event as PumpFunTradeEvent);
    } else if (event.name === "BuyEvent") {
      result = convertPumpAmmBuyEvent(event as PumpAmmBuyEvent);
    } else if (event.name === "SellEvent") {
      result = convertPumpAmmSellEvent(event as PumpAmmSellEvent);
    } else {
      console.log(`⚠️ Unknown event type: ${(event as any).name}`);
      return null;
    }
    
    // Add metadata if available
    if (transactionSignature) {
      result.signature = transactionSignature;
    }
    if (slot !== undefined) {
      result.slot = slot;
    }
    if (createdAt) {
      result.createdAt = createdAt;
    }
    
    return result;
  } catch (error: any) {
    console.error(`❌ Error converting ladybug event:`, error?.message || error);
    return null;
  }
}

/**
 * Extract token mint address from PumpAmm event
 * This is a helper function that may need to fetch from pool or other sources
 * For now, we'll return null and let the tracker handle it
 */
export function extractTokenMintFromPumpAmmEvent(event: PumpAmmBuyEvent | PumpAmmSellEvent): string | null {
  // The token mint is not directly in the event data
  // We may need to fetch it from the pool account or other sources
  // For now, return null and let the tracker handle it through other means
  return null;
}

