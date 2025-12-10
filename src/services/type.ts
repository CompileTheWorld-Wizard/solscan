/**
 * Types for Ladybug SDK event data structures
 * Based on the event data format from ladybug-sdk
 */

/**
 * PumpFun TradeEvent data structure
 */
export interface PumpFunTradeEventData {
  mint: string;
  sol_amount: number;
  token_amount: number;
  is_buy: boolean;
  user: string;
  timestamp: number;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  real_sol_reserves: number;
  real_token_reserves: number;
  fee_recipient: string;
  fee_basis_points: number;
  fee: number;
  creator: string;
  creator_fee_basis_points: number;
  creator_fee: number;
  track_volume: boolean;
  total_unclaimed_tokens: number;
  total_claimed_tokens: number;
  current_sol_volume: number;
  last_update_timestamp: number;
  ix_name: string;
}

/**
 * PumpFun TradeEvent structure
 */
export interface PumpFunTradeEvent {
  name: "TradeEvent";
  data: PumpFunTradeEventData;
}

/**
 * PumpAmm BuyEvent data structure
 */
export interface PumpAmmBuyEventData {
  timestamp: number;
  base_amount_out: number;
  max_quote_amount_in: number;
  user_base_token_reserves: number;
  user_quote_token_reserves: number;
  pool_base_token_reserves: number;
  pool_quote_token_reserves: number;
  quote_amount_in: number;
  lp_fee_basis_points: number;
  lp_fee: number;
  protocol_fee_basis_points: number;
  protocol_fee: number;
  quote_amount_in_with_lp_fee: number;
  user_quote_amount_in: number;
  pool: string;
  user: string;
  user_base_token_account: string;
  user_quote_token_account: string;
  protocol_fee_recipient: string;
  protocol_fee_recipient_token_account: string;
  coin_creator: string;
  coin_creator_fee_basis_points: number;
  coin_creator_fee: number;
  track_volume?: boolean;
  total_unclaimed_tokens?: number;
  total_claimed_tokens?: number;
  current_sol_volume?: number;
  last_update_timestamp?: number;
  min_base_amount_out?: number;
  ix_name?: string;
}

/**
 * PumpAmm SellEvent data structure
 */
export interface PumpAmmSellEventData {
  timestamp: number;
  base_amount_in: number;
  min_quote_amount_out: number;
  user_base_token_reserves: number;
  user_quote_token_reserves: number;
  pool_base_token_reserves: number;
  pool_quote_token_reserves: number;
  quote_amount_out: number;
  lp_fee_basis_points: number;
  lp_fee: number;
  protocol_fee_basis_points: number;
  protocol_fee: number;
  quote_amount_out_without_lp_fee: number;
  user_quote_amount_out: number;
  pool: string;
  user: string;
  user_base_token_account: string;
  user_quote_token_account: string;
  protocol_fee_recipient: string;
  protocol_fee_recipient_token_account: string;
  coin_creator: string;
  coin_creator_fee_basis_points: number;
  coin_creator_fee: number;
}

/**
 * PumpAmm BuyEvent structure
 */
export interface PumpAmmBuyEvent {
  name: "BuyEvent";
  data: PumpAmmBuyEventData;
}

/**
 * PumpAmm SellEvent structure
 */
export interface PumpAmmSellEvent {
  name: "SellEvent";
  data: PumpAmmSellEventData;
}

/**
 * Union type for all PumpFun events
 */
export type PumpFunEvent = PumpFunTradeEvent;

/**
 * Union type for all PumpAmm events
 */
export type PumpAmmEvent = PumpAmmBuyEvent | PumpAmmSellEvent;

/**
 * Union type for all supported ladybug events
 */
export type ParsedEvent = PumpFunEvent | PumpAmmEvent;

/**
 * Ladybug transaction structure (as received from streamer)
 */
export interface ParsedTransaction {
  transaction: {
    signatures?: string[];
    message?: {
      events?: ParsedEvent[];
    };
    slot?: number;
    blockTime?: number;
  };
  createdAt?: string;
}

