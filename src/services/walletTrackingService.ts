/**
 * Wallet Tracking Service
 * Tracks wallet-token pairs from buy/sell events
 * Separate from token info extraction module
 * 
 * Tracks:
 * - First Buy Timestamp & Amount
 * - First Sell Timestamp & Amount
 */

import { dbService } from '../database';

export class WalletTrackingService {
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';

  /**
   * Track wallet-token pair from buy/sell event
   * Extracts the non-SOL token from the transaction and records first buy/sell
   */
  async trackWalletToken(
    walletAddress: string,
    mintFrom: string,
    mintTo: string,
    inAmount: string,
    outAmount: string,
    transactionType: string
  ): Promise<void> {
    try {
      const txType = transactionType.toUpperCase();

      // Validate transaction type
      if (txType !== 'BUY' && txType !== 'SELL') {
        console.log(`⚠️ Wallet tracking skipped - not a buy/sell transaction: ${transactionType}`);
        return;
      }

      // Extract the token (non-SOL) from the transaction
      let tokenAddress: string | null = null;
      let amount: string;

      if (txType === 'BUY') {
        // For BUY: mintTo is the token we're buying (should not be SOL)
        if (mintTo && mintTo !== this.SOL_MINT) {
          tokenAddress = mintTo;
          amount = inAmount; // Amount spent to buy (e.g., SOL amount)
        }
      } else if (txType === 'SELL') {
        // For SELL: mintFrom is the token we're selling (should not be SOL)
        if (mintFrom && mintFrom !== this.SOL_MINT) {
          tokenAddress = mintFrom;
          amount = outAmount; // Amount received from sell (e.g., SOL amount)
        }
      }

      // If no valid token found, skip
      if (!tokenAddress) {
        console.log(`⚠️ No valid token found to track (mintFrom: ${mintFrom?.substring(0, 8)}, mintTo: ${mintTo?.substring(0, 8)})`);
        return;
      }

      // Validate wallet address
      if (!walletAddress || walletAddress.length === 0) {
        console.log(`⚠️ Invalid wallet address for tracking`);
        return;
      }

      // Validate amount
      if (!amount) {
        console.log(`⚠️ No amount found for tracking`);
        return;
      }

      // Fetch market data from Solscan API before saving
      console.log(`👛 [Wallet: ${walletAddress.substring(0, 8)}...] [Token: ${tokenAddress.substring(0, 8)}...] [Type: ${txType}] [Amount: ${amount}]`);
      
      let marketData: {
        supply: string | null;
        price: number | null;
        decimals: number | null;
        market_cap: number | null;
      } | null = null;
      
      let isEmptyData = false;
      
      try {
        const fetchResult = await dbService.fetchMcapFromSolscan(tokenAddress);
        
        // Check if result indicates empty data (token not indexed yet)
        if (fetchResult && fetchResult.isEmpty === true) {
          isEmptyData = true;
          console.log(`   ⏳ Token not indexed in Solscan yet, will retry in 60 seconds...`);
        } else {
          marketData = fetchResult;
          if (marketData) {
            if (marketData.market_cap !== null) {
              console.log(`   MCap: ${marketData.market_cap}, Supply: ${marketData.supply || 'N/A'}, Price: ${marketData.price || 'N/A'}`);
            } else {
              console.log(`   MCap: Not available, Supply: ${marketData.supply || 'N/A'}, Price: ${marketData.price || 'N/A'}`);
            }
          } else {
            console.log(`   Market data: Not available`);
          }
        }
      } catch (error: any) {
        console.warn(`⚠️ Failed to fetch market data, continuing without it:`, error.message);
      }

      // Save wallet-token pair to database (save first even if market data is empty)
      await dbService.saveWalletTokenPair(walletAddress, tokenAddress, txType as 'BUY' | 'SELL', amount, marketData);

      // If data was empty, schedule a retry after 60 seconds (non-blocking)
      if (isEmptyData) {
        setTimeout(async () => {
          try {
            console.log(`🔄 Retrying market data fetch for ${tokenAddress.substring(0, 8)}... after 60 seconds...`);
            const retryMarketData = await dbService.fetchMcapFromSolscan(tokenAddress);
            
            if (retryMarketData && !retryMarketData.isEmpty) {
              // Update the saved wallet-token pair with market data
              await dbService.updateWalletTokenMarketData(
                walletAddress,
                tokenAddress,
                txType as 'BUY' | 'SELL',
                retryMarketData
              );
              
              if (retryMarketData.market_cap !== null) {
                console.log(`   ✅ Retry successful - MCap: ${retryMarketData.market_cap}, Supply: ${retryMarketData.supply || 'N/A'}`);
              } else {
                console.log(`   ✅ Retry successful - Supply: ${retryMarketData.supply || 'N/A'}, MCap: Not available`);
              }
            } else {
              console.log(`   ⚠️ Token still not indexed, skipping update`);
            }
          } catch (error: any) {
            console.warn(`⚠️ Error in market data retry:`, error.message);
          }
        }, 60000); // Retry after 60 seconds
      }

    } catch (error: any) {
      console.error(`❌ Error tracking wallet-token pair:`, error.message);
    }
  }

  /**
   * Get all tokens traded by a wallet
   */
  async getWalletTokens(walletAddress: string): Promise<any[]> {
    try {
      return await dbService.getWalletTokens(walletAddress);
    } catch (error: any) {
      console.error(`❌ Error fetching wallet tokens:`, error.message);
      return [];
    }
  }

  /**
   * Get all wallets that traded a specific token
   */
  async getTokenWallets(tokenAddress: string, limit: number = 50): Promise<any[]> {
    try {
      return await dbService.getTokenWallets(tokenAddress, limit);
    } catch (error: any) {
      console.error(`❌ Error fetching token wallets:`, error.message);
      return [];
    }
  }

  /**
   * Get all wallet-token pairs with pagination
   */
  async getAllWalletTokenPairs(limit: number = 50, offset: number = 0): Promise<any[]> {
    try {
      return await dbService.getWalletTokenPairs(limit, offset);
    } catch (error: any) {
      console.error(`❌ Error fetching wallet-token pairs:`, error.message);
      return [];
    }
  }
}

// Export singleton instance
export const walletTrackingService = new WalletTrackingService();

