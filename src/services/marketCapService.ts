import { dbService } from '../database';
import { Connection, PublicKey } from '@solana/web3.js';
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
  private shyftConnection: Connection | null = null;

  constructor() {
    this.solscanApiKey = process.env.SOLSCAN_API_KEY || '';

    if (!this.solscanApiKey) {
      console.warn('⚠️ Warning: SOLSCAN_API_KEY not set in environment variables');
    }
    // Initialize Shyft RPC connection
    const shyftApiKey = process.env.SHYFT_API_KEY;
    if (shyftApiKey) {
      // Shyft RPC endpoint format: https://rpc.shyft.to?api_key=YOUR_API_KEY
      const shyftRpcUrl = `https://rpc.shyft.to?api_key=${shyftApiKey}`;
      this.shyftConnection = new Connection(shyftRpcUrl, 'confirmed');
    } else {
      console.warn('⚠️ Warning: SHYFT_API_KEY not set, token supply will use fallback RPC');
      // Fallback to default Solana RPC or SOLANA_RPC_URL if available
      const fallbackRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      this.shyftConnection = new Connection(fallbackRpcUrl, 'confirmed');
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
   * Get token metadata using getTokenSupply from web3.js via Shyft RPC
   */
  private async getTokenSupply(address: string): Promise<TokenMetaResponse> {
    if (!this.shyftConnection) {
      return {
        success: false,
        error: "RPC connection not initialized"
      };
    }

    try {
      const mintPublicKey = new PublicKey(address);
      
      // Get token supply using web3.js getTokenSupply method
      const tokenSupply = await this.shyftConnection.getTokenSupply(mintPublicKey);
      
      // Transform the result to match TokenMetaResponse interface
      return {
        success: true,
        data: {
          address: address,
          supply: tokenSupply.value.amount, // Raw amount as string
          decimals: tokenSupply.value.decimals,
          raw_amount: tokenSupply.value.amount // Keep raw_amount for backward compatibility
        }
      };
    } catch (error) {
      console.error("Error fetching token supply via RPC:", error);

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
   * @param tokenAddress - Token address (parsed from tracker)
   * @returns Market cap result with calculated market cap value
   */
  async calculateMarketCap(signature: string, tokenAddress: string): Promise<MarketCapResult> {
    try {
      // Validate token address parameter
      if (!tokenAddress) {
        return {
          success: false,
          error: "Token address is required"
        };
      }

      // Step 1: Fetch token supply information first (using provided token address)
      const tokenMetaResult = await this.getTokenSupply(tokenAddress);
      
      if (!tokenMetaResult.success || !tokenMetaResult.data) {
        return {
          success: false,
          error: tokenMetaResult.error || "Failed to fetch token supply information"
        };
      }

      // Step 2: Get transaction details
      
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
      // Step 3: Find AMM ID from swap activity
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

      // Step 4: Get SOL and token amounts
      const sol_amount = this.getAmount(sol_bal_change, amm_id, 1);
      const token_amount = this.getAmount(token_bal_change, amm_id, 2);

      if (!sol_amount || !token_amount || !sol_amount.pre_balance || !token_amount.pre_balance) {
        return {
          success: false,
          error: "Balance changes not found for AMM"
        };
      }

      // Step 5: Calculate market cap
      const token_supply = parseFloat(tokenMetaResult.data?.raw_amount || ' 0 ') / Math.pow(10, (tokenMetaResult.data?.decimals || 0)) ;
      const tokenBal = token_amount?.pre_balance / Math.pow(10, (tokenMetaResult.data?.decimals || 0) )
      const solBal = sol_amount?.pre_balance / 1000000000
      const solUsd = await dbService.getLatestSolPrice();
      
      const $sol: number = solBal * solUsd;
      const tokenBought: number = token_supply - tokenBal;
      const tokenBoughtPrice: number = $sol / tokenBought;
      const tokenValue = tokenBoughtPrice * token_supply;
      const price = tokenValue / tokenBal;
      const marketCap = price * token_supply;

      return {
        success: true,
        marketCap,
        tokenSupply: token_supply,
        tokenBalance: tokenBal,
        solAmount: sol_amount.pre_balance / 1000000000, // Convert to SOL
        tokenAddress: tokenAddress
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

