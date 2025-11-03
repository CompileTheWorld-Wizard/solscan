import { dbService } from '../database';
/**
 * Market Cap Service
 * Calculates market cap from transaction signature using Solscan API
 */

interface TransactionDetailResponse {
  success: boolean;
  data?: {
    parsed_instructions?: any[];
    sol_bal_change?: any[];
    token_bal_change?: any[];
    [key: string]: any;
  };
  metadata?: {
    tokens?: {
      [key: string]: any;
    };
  };
  error?: string;
}

interface TokenMetaResponse {
  success: boolean;
  data?: {
    address?: string;
    name?: string;
    symbol?: string;
    supply?: string;
    decimals?: number;
    [key: string]: any;
  };
  metadata?: any;
  error?: string;
}

interface BalanceChange {
  pre_balance?: number;
  post_balance?: number;
  change_amount?: number;
}

interface MarketCapResult {
  success: boolean;
  marketCap?: number;
  tokenSupply?: number;
  tokenBalance?: number;
  solAmount?: number;
  tokenAddress?: string;
  error?: string;
}

export class MarketCapService {
  private solscanApiKey: string;

  constructor() {
    this.solscanApiKey = process.env.SOLSCAN_API_KEY || '';

    if (!this.solscanApiKey) {
      console.warn('⚠️ Warning: SOLSCAN_API_KEY not set in environment variables');
    }
  }

  /**
   * Get transaction details from Solscan API
   */
  private async getTransactionDetail(signature: string): Promise<TransactionDetailResponse> {
    if (!this.solscanApiKey) {
      throw new Error("SOLSCAN_API_KEY environment variable is not set. Please check your .env file.");
    }

    const url = `https://pro-api.solscan.io/v2.0/transaction/detail?tx=${signature}`;
    
    const requestOptions: RequestInit = {
      method: "get",
      headers: {
        "token": this.solscanApiKey
      }
    };

    try {
      const response = await fetch(url, requestOptions);
      const data = await response.json() as TransactionDetailResponse;
      return data;
    } catch (error) {
      console.error("Error fetching transaction detail:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get token metadata from Solscan API
   */
  private async getTokenMeta(address: string): Promise<TokenMetaResponse> {
    if (!this.solscanApiKey) {
      throw new Error("SOLSCAN_API_KEY environment variable is not set. Please check your .env file.");
    }

    const url = `https://pro-api.solscan.io/v2.0/token/meta?address=${address}`;
    
    const requestOptions: RequestInit = {
      method: "get",
      headers: {
        "token": this.solscanApiKey
      }
    };

    try {
      const response = await fetch(url, requestOptions);
      const data = await response.json() as TokenMetaResponse;
      return data;
    } catch (error) {
      console.error("Error fetching token metadata:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Find swap activity in instructions
   */
  private isInSwap(activities: any[]): any | null {
    for (const activity of activities) {
      if (JSON.stringify(activity.activity_type).includes('swap')) {
        return activity;
      }
    }
    return null;
  }

  /**
   * Get balance change for a specific address
   * @param changes - Array of balance changes
   * @param value - Address or owner to search for
   * @param type - 1 for address match, 2 for owner match
   */
  private getAmount(changes: any[], value: any, type: number): BalanceChange | null {
    for (const change of changes) {
      if (type === 1 ? (change.address == value) : (change.owner == value)) {
        return {
          pre_balance: change?.pre_balance,
          post_balance: change?.post_balance,
          change_amount: change?.change_amount
        };
      }
    }
    return null;
  }

  /**
   * Calculate market cap from transaction signature
   * @param signature - Transaction signature
   * @returns Market cap result with calculated market cap value
   */
  async calculateMarketCap(signature: string): Promise<MarketCapResult> {
    try {
      // Step 1: Get transaction details
      const transactionResult = await this.getTransactionDetail(signature);
      
      if (!transactionResult.success || !transactionResult.data) {
        return {
          success: false,
          error: transactionResult.error || "Failed to fetch transaction details"
        };
      }

      const parsed_instructions = transactionResult.data.parsed_instructions || [];
      const sol_bal_change = transactionResult.data.sol_bal_change || [];
      const token_bal_change = transactionResult.data.token_bal_change || [];
      
      // Get token address from metadata
      const token_address = transactionResult.metadata?.tokens 
        ? Object.keys(transactionResult.metadata.tokens)[0]?.toString()
        : null;

      if (!token_address) {
        return {
          success: false,
          error: "Token address not found in transaction metadata"
        };
      }

      // Step 2: Find AMM ID from swap activity
      let amm_id: string | null = null;
      for (const instruction of parsed_instructions) {
        if (instruction.activities) {
          const swapResult = this.isInSwap(instruction.activities);
          if (swapResult) {
            amm_id = swapResult?.data?.amm_id;
            break;
          }
        }
      }

      if (!amm_id) {
        return {
          success: false,
          error: "AMM ID not found in swap activities"
        };
      }

      // Step 3: Get SOL and token amounts
      const sol_amount = this.getAmount(sol_bal_change, amm_id, 1);
      const token_amount = this.getAmount(token_bal_change, amm_id, 2);

      if (!sol_amount || !token_amount || !sol_amount.pre_balance || !token_amount.pre_balance) {
        return {
          success: false,
          error: "Balance changes not found for AMM"
        };
      }

      // Step 4: Get token metadata
      const tokenMetaResult = await this.getTokenMeta(token_address);
      
      if (!tokenMetaResult.success || !tokenMetaResult.data) {
        return {
          success: false,
          error: tokenMetaResult.error || "Failed to fetch token metadata"
        };
      }

      // Step 5: Calculate market cap
      const token_supply = parseFloat(tokenMetaResult.data?.raw_amount || ' 0 ') / Math.pow(10, (tokenMetaResult.data?.decimals || 0) + 1) ;
      const tokenBal = token_amount?.post_balance / Math.pow(10, (tokenMetaResult.data?.decimals || 0) + 1)
      const solBal = sol_amount?.post_balance / 1000000000
      console.log(`Supply: ${token_supply}`)
      console.log(`Token Balance: ${tokenBal}`)
      console.log(`Sol Balance: ${tokenBal}`)

      const solUsd = await dbService.getLatestSolPrice();
      console.log(solUsd);
      const $sol: number = solBal * solUsd;
      const tokenBought: number = token_supply - tokenBal;
      const tokenBoughtPrice: number = $sol / tokenBought;
      const tokenValue = tokenBoughtPrice * token_supply;
      const price = tokenValue / tokenBal;
      console.log(price);
      const marketCap = price * token_supply;
      console.log('marketCap : ', marketCap);

      return {
        success: true,
        marketCap,
        tokenSupply: token_supply,
        tokenBalance: tokenBal,
        solAmount: sol_amount.pre_balance / 1000000000, // Convert to SOL
        tokenAddress: token_address
      };

    } catch (error) {
      console.error("Error calculating market cap:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
}

export const marketCapService = new MarketCapService();

