/**
 * Bitquery Service
 * Handles fetching ATH market cap data from Bitquery API
 */

import axios from 'axios';

interface BitqueryTradeCurrency {
  MintAddress: string;
  Name?: string;
  Symbol?: string;
}

interface BitquerySideCurrency {
  Symbol?: string;
}

interface BitqueryTrade {
  Currency: BitqueryTradeCurrency;
  PriceInUSD: number;
  Side: {
    Currency: BitquerySideCurrency;
  };
}

interface BitqueryResponse {
  data: {
    Solana: {
      DEXTradeByTokens: Array<{
        Trade: BitqueryTrade;
        max: number;
        ATH_Marketcap: number;
      }>;
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ATHMarketCapResult {
  mintAddress: string;
  name?: string;
  symbol?: string;
  athPriceUSD: number;
  athMarketCap: number;
}

export class BitqueryService {
  private apiKey: string;
  private readonly API_URL = 'https://streaming.bitquery.io/graphql';

  constructor() {
    this.apiKey = process.env.BITQUERY_API_KEY || '';

    if (!this.apiKey) {
      console.warn('⚠️ Warning: BITQUERY_API_KEY not set in environment variables');
    }
  }

  /**
   * Get ATH market cap for a list of tokens
   * @param tokenAddresses Array of token mint addresses
   * @param sinceDate Optional date string in ISO format (e.g., "2025-05-03T06:37:00Z"). Defaults to a date in the past if not provided.
   * @returns Array of ATH market cap results for each token
   */
  async getATHMarketCap(
    tokenAddresses: string[],
    sinceDate?: string
  ): Promise<ATHMarketCapResult[]> {
    if (!this.apiKey) {
      throw new Error('BITQUERY_API_KEY is not set in environment variables');
    }

    if (!tokenAddresses || tokenAddresses.length === 0) {
      return [];
    }

    // Default since date if not provided (e.g., 1 year ago)
    const defaultSinceDate = sinceDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    // Base currencies (SOL and USDC)
    const baseCurrencies = [
      '11111111111111111111111111111111', // Native SOL
      'So11111111111111111111111111111111111111112', // Wrapped SOL
    ];

    // Format token addresses for GraphQL array (inline values, not variables)
    const tokenAddressesList = tokenAddresses.map(addr => `"${addr}"`).join(', ');
    const baseCurrenciesList = baseCurrencies.map(addr => `"${addr}"`).join(', ');

    // Build the GraphQL query (Bitquery expects inline values, matching the exact format)
    const query = `{\n  Solana(dataset: combined) {\n    DEXTradeByTokens(\n      limitBy: {by: Trade_Currency_MintAddress, count: 1}\n      where: {Trade: {Currency: {MintAddress: {in: [${tokenAddressesList}]}}, Side: {Currency: {MintAddress: {in: [${baseCurrenciesList}]}}}}, Block: {Time: {since: "${defaultSinceDate}"}}}\n    ) {\n      Trade {\n        Currency {\n          MintAddress\n          Name\n          Symbol\n        }\n        PriceInUSD(maximum: Trade_PriceInUSD)\n        Side {\n          Currency {\n            Symbol\n          }\n        }\n      }\n      max: quantile(of: Trade_PriceInUSD, level: 0.98)\n      ATH_Marketcap: calculate(expression: "$max * 1000000000")\n\n    }\n  }\n}\n`;

    try {
      const response = await axios.post<BitqueryResponse>(
        this.API_URL,
        {
          query,
          variables: {},
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      );

      if (response.data.errors) {
        throw new Error(`Bitquery API errors: ${JSON.stringify(response.data.errors)}`);
      }

      const trades = response.data.data?.Solana?.DEXTradeByTokens || [];

      // Transform the response to a more usable format
      const results: ATHMarketCapResult[] = trades.map((trade) => {
        const firstTrade = trade.Trade;
        return {
          mintAddress: firstTrade?.Currency?.MintAddress || '',
          name: firstTrade?.Currency?.Name,
          symbol: firstTrade?.Currency?.Symbol,
          athPriceUSD: trade.max || 0,
          athMarketCap: trade.ATH_Marketcap || 0,
        };
      });

      return results;
    } catch (error: any) {
      console.error('Failed to fetch ATH market cap from Bitquery:', error.message || error);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Get ATH market cap for a single token
   * @param tokenAddress Token mint address
   * @param sinceDate Optional date string in ISO format
   * @returns ATH market cap result or null if not found
   */
  async getATHMarketCapForToken(
    tokenAddress: string,
    sinceDate?: string
  ): Promise<ATHMarketCapResult | null> {
    const results = await this.getATHMarketCap([tokenAddress], sinceDate);
    return results.length > 0 ? results[0] : null;
  }
}

// Export singleton instance
export const bitqueryService = new BitqueryService();

