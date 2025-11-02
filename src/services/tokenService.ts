/**
 * Token Service
 * Handles fetching token creator and first buy amount using Solscan API
 */

interface SolscanActivity {
  block_id: number;
  trans_id: string;
  block_time: number;
  activity_type: string;
  from_address: string;
  sources: string[];
  platform: string[];
  value: number;
  routers: {
    token1?: string;
    token1_decimals?: number;
    token2?: string;
    token2_decimals?: number;
    amount1?: number | null;
    amount2?: number | null;
    amount3?: number | null;
    amount4?: number | null;
    pool_address?: string;
    child_routers?: any[];
  };
  time: string;
}

interface SolscanActivitiesResponse {
  success: boolean;
  data: SolscanActivity[];
  metadata?: {
    tokens: {
      [key: string]: {
        token_address: string;
        token_name: string;
        token_symbol: string;
        token_icon?: string;
      };
    };
  };
}

interface TokenCreatorInfo {
  creator: string;
  devBuyAmount: string;
  devBuyAmountDecimal: number;
  devBuyUsedToken: string;
  devBuyTokenAmount: string;
  devBuyTokenAmountDecimal: number;
}

export class TokenService {
  private solscanApiKey: string;
  private skipTokensCache: Set<string> = new Set();
  private lastSkipTokensUpdate: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private cacheInitialized: boolean = false;

  constructor() {
    this.solscanApiKey = process.env.SOLSCAN_API_KEY || '';

    if (!this.solscanApiKey) {
      console.warn('⚠️ Warning: SOLSCAN_API_KEY not set in environment variables');
    }
  }

  /**
   * Refresh the skip tokens cache from database
   */
  async refreshSkipTokensCache(): Promise<void> {
    try {
      const { dbService } = await import('../database');
      const skipTokens = await dbService.getSkipTokens();
      this.skipTokensCache = new Set(skipTokens.map(t => t.mint_address));
      this.lastSkipTokensUpdate = Date.now();
      this.cacheInitialized = true;
    } catch (error) {
      console.error('Failed to refresh skip tokens cache:', error);
      this.cacheInitialized = true; // Mark as initialized even on error to prevent infinite loops
    }
  }

  /**
   * Ensure cache is initialized and fresh
   */
  private async ensureFreshCache(): Promise<void> {
    // Initialize cache if not done yet
    if (!this.cacheInitialized) {
      await this.refreshSkipTokensCache();
      return;
    }

    // Refresh if cache is stale
    const now = Date.now();
    if (now - this.lastSkipTokensUpdate > this.CACHE_TTL) {
      await this.refreshSkipTokensCache();
    }
  }

  /**
   * Check if a token should be skipped
   */
  async shouldSkipToken(mintAddress: string): Promise<boolean> {
    await this.ensureFreshCache();
    const shouldSkip = this.skipTokensCache.has(mintAddress);
    if (shouldSkip) {
      console.log(`    🚫 Token ${mintAddress.substring(0, 8)}... is in skip list`);
    }
    return shouldSkip;
  }

  /**
   * Get token activities from Solscan API
   * Fetches the first activities for a token, sorted by block_time ascending
   */
  async getTokenActivities(mintAddress: string, isRetry: boolean = false): Promise<SolscanActivitiesResponse | null> {
    try {
      const url = `https://pro-api.solscan.io/v2.0/token/defi/activities?address=${mintAddress}&page=1&page_size=10&sort_by=block_time&sort_order=asc`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'token': this.solscanApiKey,
        },
      });

      const data: SolscanActivitiesResponse = await response.json();

      if (!data.success || !data.data || data.data.length === 0) {
        // If empty and not a retry, wait and retry once (newly minted token)
        if (!isRetry) {
          console.log(`⏰ Empty response - token likely newly minted. Waiting 10 seconds before retry...`);
          await this.sleep(10000);
          return this.getTokenActivities(mintAddress, true); // Retry
        }
        console.log(`  ⚠️  No activities found for token`);
        return null;
      }

      console.log(`  ✅ Found ${data.data.length} activities`);
      return data;
    } catch (error: any) {
      console.error('Failed to fetch token activities from Solscan:', error.message || error);
      return null;
    }
  }

  /**
   * Sleep helper function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract first buy information from Solscan activities response
   */
  async extractFirstBuyFromActivities(
    activitiesResponse: SolscanActivitiesResponse,
    mintAddress: string
  ): Promise<TokenCreatorInfo | null> {
    if (!activitiesResponse.data || activitiesResponse.data.length === 0) {
      return null;
    }

    // Find the first ACTIVITY_TOKEN_SWAP
    const firstSwap = activitiesResponse.data.find(
      activity => activity.activity_type === 'ACTIVITY_TOKEN_SWAP'
    );

    if (!firstSwap || !firstSwap.routers) {
      console.log(`  ⚠️  No ACTIVITY_TOKEN_SWAP found in activities`);
      return null;
    }

    const routers = firstSwap.routers;
    
    // Determine which token is which (token1 or token2 is the mint we're looking for)
    let tokenIn: string;
    let tokenOut: string;
    let amountIn: number;
    let amountOut: number;
    let decimalIn: number;
    let decimalOut: number;
    let swapper: string;

    // Check if token2 is the output (buying mintAddress)
    if (routers.token2 === mintAddress) {
      if (!routers.token1 || routers.amount1 === null || routers.amount1 === undefined || routers.amount2 === null || routers.amount2 === undefined) {
        console.log(`  ⚠️  Swap activity has incomplete data (token2 match)`);
        return null;
      }
      tokenIn = routers.token1;
      tokenOut = routers.token2;
      amountIn = routers.amount1;
      amountOut = routers.amount2;
      decimalIn = routers.token1_decimals || 0;
      decimalOut = routers.token2_decimals || 0;
      swapper = firstSwap.from_address;
    }
    // Check if token1 is the output (buying mintAddress)
    else if (routers.token1 === mintAddress) {
      if (!routers.token2 || routers.amount1 === null || routers.amount1 === undefined || routers.amount2 === null || routers.amount2 === undefined) {
        console.log(`  ⚠️  Swap activity has incomplete data (token1 match)`);
        return null;
      }
      tokenIn = routers.token2;
      tokenOut = routers.token1;
      amountIn = routers.amount2;
      amountOut = routers.amount1;
      decimalIn = routers.token2_decimals || 0;
      decimalOut = routers.token1_decimals || 0;
      swapper = firstSwap.from_address;
    } else {
      console.log(`  ⚠️  Swap activity does not involve token ${mintAddress}`);
      return null;
    }

    // Calculate the human-readable amount for logging
    const humanAmountIn = amountIn / Math.pow(10, decimalIn);
    const humanAmountOut = amountOut / Math.pow(10, decimalOut);

    // First buy found!
    console.log(`  🎉 Creator: ${swapper}`);
    console.log(`  💰 Dev Buy: ${humanAmountIn} for ${humanAmountOut} tokens`);
    console.log(`  📊 Raw amounts: ${amountIn} (decimal: ${decimalIn}) -> ${amountOut} (decimal: ${decimalOut})`);

    return {
      creator: swapper,
      devBuyAmount: amountIn.toString(),
      devBuyAmountDecimal: decimalIn,
      devBuyUsedToken: tokenIn,
      devBuyTokenAmount: amountOut.toString(),
      devBuyTokenAmountDecimal: decimalOut,
    };
  }

  /**
   * Main method to get token creator and first buy amount
   */
  async getTokenCreatorInfo(mintAddress: string): Promise<TokenCreatorInfo | null> {
    console.log(`🔍 Fetching token creator info for: ${mintAddress}`);

    // Check if this token should be skipped
    if (await this.shouldSkipToken(mintAddress)) {
      console.log(`  🚫 Token ${mintAddress.substring(0, 8)}... is in skip list - skipping analysis`);
      return null;
    }

    // Step 1: Get token activities from Solscan API
    const activitiesResponse = await this.getTokenActivities(mintAddress);

    if (!activitiesResponse) {
      console.log('  ❌ No activities found for this token');
      return null;
    }

    // Step 2: Extract first buy info from activities
    const creatorInfo = await this.extractFirstBuyFromActivities(activitiesResponse, mintAddress);

    if (creatorInfo) {
      return creatorInfo;
    }

    console.log('  ❌ Could not extract buy information from activities');
    return null;
  }
}

export const tokenService = new TokenService();

