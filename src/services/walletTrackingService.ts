/**
 * Wallet Tracking Service
 * Tracks wallet-token pairs from buy/sell events
 * Separate from token info extraction module
 * 
 * Tracks:
 * - First Buy Timestamp & Amount
 * - First Sell Timestamp & Amount
 * - Pool monitoring for first buys
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { dbService } from '../database';
import { PoolMonitoringService } from './poolMonitoringService';

interface MarketCapResult {
  success: boolean;
  marketCap?: number;
  tokenSupply?: number;
  tokenBalance?: number;
  solAmount?: number;
  tokenAddress?: string;
  price?: number; // Token price in USD
  decimals?: number; // Token decimals
  error?: string;
}

export class WalletTrackingService {
  private poolMonitoringService: PoolMonitoringService | null = null;
  private solanaConnection: Connection | null = null;

  /**
   * Initialize with Solana connection for pool monitoring
   */
  async initialize(solanaConnection: Connection): Promise<void> {
    this.solanaConnection = solanaConnection;
    this.poolMonitoringService = await PoolMonitoringService.getInstance(solanaConnection);
  }

  /**
   * Track wallet-token pair from buy/sell event
   * Records first buy/sell for a wallet-token pair
   * Uses marketcap from tracker (passed as marketCapResult) instead of fetching it
   * Starts pool monitoring for first buys
   */
  async trackWalletToken(
    walletAddress: string,
    tokenAddress: string,
    inAmount: string,
    outAmount: string,
    transactionType: string,
    marketCapResult: MarketCapResult | null = null,
    poolAddress?: string
  ): Promise<void> {
    try {
      const txType = transactionType.toUpperCase();

      // Validate transaction type
      if (txType !== 'BUY' && txType !== 'SELL') {
        console.log(`⚠️ Wallet tracking skipped - not a buy/sell transaction: ${transactionType}`);
        return;
      }

      // Determine amount based on transaction type
      let amount: string;
      if (txType === 'BUY') {
        amount = inAmount; // Amount spent to buy (e.g., SOL amount)
      } else {
        amount = outAmount; // Amount received from sell (e.g., SOL amount)
      }

      // Validate inputs
      if (!walletAddress || walletAddress.length === 0) {
        console.log(`⚠️ Invalid wallet address for tracking`);
        return;
      }

      if (!tokenAddress || tokenAddress.length === 0) {
        console.log(`⚠️ Invalid token address for tracking`);
        return;
      }

      if (!amount) {
        console.log(`⚠️ No amount found for tracking`);
        return;
      }

      console.log(`👛 [Wallet: ${walletAddress.substring(0, 8)}...] [Token: ${tokenAddress.substring(0, 8)}...] [Type: ${txType}] [Amount: ${amount}]`);
      
      // Build market data from parsed transaction (marketCapResult) if available
      let marketData: {
        supply: string | null;
        price: number | null;
        decimals: number | null;
        market_cap: number | null;
      } | null = null;

      // Use data from parsed transaction (marketCapResult) if available
      if (marketCapResult) {
        // Build market data using data from parsed transaction
        // Include price/decimals even if marketCap is not available
        marketData = {
          market_cap: marketCapResult.marketCap !== undefined ? marketCapResult.marketCap : null,
          supply: marketCapResult.tokenSupply ? marketCapResult.tokenSupply.toString() : null,
          price: marketCapResult.price !== undefined ? marketCapResult.price : null,
          decimals: marketCapResult.decimals !== undefined ? marketCapResult.decimals : null
        };
        if (marketCapResult.success && typeof marketCapResult.marketCap === 'number') {
          console.log(`   MCap (from transaction): $${marketCapResult.marketCap}, Supply: ${marketData.supply || 'N/A'}, Price: ${marketData.price || 'N/A'}, Decimals: ${marketData.decimals || 'N/A'}`);
        } else {
          console.log(`   Price (from transaction): ${marketData.price || 'N/A'}, Decimals: ${marketData.decimals || 'N/A'}, MCap: N/A`);
        }
      } else {
        // No market data from transaction - set to null
        marketData = null;
        console.log(`   Market data: Not available from transaction`);
      }

      // Check if this is the first buy BEFORE saving (for pool monitoring)
      let isFirstBuy = false;
      if (txType === 'BUY') {
        isFirstBuy = await dbService.isFirstBuy(walletAddress, tokenAddress);
      }

      
      // Handle pool monitoring for pump.fun and pump AMM
      // Start monitoring ASAP after confirming first buy (non-blocking)
      if (txType === 'BUY' && poolAddress && isFirstBuy && this.poolMonitoringService) {
        // Start pool monitoring immediately (non-blocking) - don't wait for anything
        const maxDuration = parseInt(process.env.POOL_MONITORING_MAX_DURATION || '60', 10); // Default 1 min
        
        // Prepare initial price data from buy transaction and start monitoring (non-blocking)
        (async () => {
          try {
            let initialPriceData: { priceUsd: number; priceSol: number; marketCap: number } | undefined;
            if (marketCapResult && marketCapResult.price !== undefined && marketCapResult.marketCap !== undefined) {
              // Get SOL price to calculate price in SOL (non-blocking, but we'll start monitoring even if this fails)
              try {
                const solPriceUsd = await dbService.getLatestSolPrice();
                if (solPriceUsd && solPriceUsd > 0) {
                  const priceSol = marketCapResult.price / solPriceUsd;
                  initialPriceData = {
                    priceUsd: marketCapResult.price,
                    priceSol: priceSol,
                    marketCap: marketCapResult.marketCap
                  };
                }
              } catch (solPriceError) {
                // If we can't get SOL price, still start monitoring with USD price and market cap
                initialPriceData = {
                  priceUsd: marketCapResult.price,
                  priceSol: 0, // Will be updated when we get pool updates
                  marketCap: marketCapResult.marketCap
                };
              }
            }
            
            // Start monitoring immediately (even if initialPriceData is partial)
            await this.poolMonitoringService.startMonitoring(
              walletAddress,
              tokenAddress,
              poolAddress,
              maxDuration,
              initialPriceData
            );
            console.log(`🔍 Started pool monitoring for first buy: ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}...`);
          } catch (error: any) {
            console.error(`Failed to start pool monitoring:`, error.message);
          }
        })();
      } else if (txType === 'SELL' && this.poolMonitoringService) {
        // Signal sell event to stop monitoring after 10 seconds
        // Prepare sell price data from sell transaction
        let sellPriceData: { priceUsd: number; priceSol: number; marketCap: number } | undefined;
        if (marketCapResult && marketCapResult.price !== undefined && marketCapResult.marketCap !== undefined) {
          // Get SOL price to calculate price in SOL
          const solPriceUsd = await dbService.getLatestSolPrice();
          if (solPriceUsd && solPriceUsd > 0) {
            const priceSol = marketCapResult.price / solPriceUsd;
            sellPriceData = {
              priceUsd: marketCapResult.price,
              priceSol: priceSol,
              marketCap: marketCapResult.marketCap
            };
          }
        }
        
        try {
          this.poolMonitoringService.signalSell(walletAddress, tokenAddress, sellPriceData);
          console.log(`🛑 Signaled sell event for pool monitoring: ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}...`);
        } catch (error: any) {
          console.error(`Failed to signal sell event:`, error.message);
        }
      }

      // If this is a BUY event, calculate and record the open positions count
      let openPositionCount: number | null = null;
      if (txType === 'BUY') {
        // Calculate open positions count based on buy/sell counts
        try {
          // Get buy/sell counts for all tokens held by this wallet
          const buySellCounts = await dbService.getBuySellCountsPerToken(walletAddress);
          
          // Calculate open trades: for each token, if buys > sells, count as 1, else 0
          let openTradeCount = 0;
          for (const [mint, counts] of buySellCounts.entries()) {
            if (counts.buyCount > counts.sellCount) {
              openTradeCount += 1;
            }
          }
          
          openPositionCount = openTradeCount;
        } catch (error: any) {
          console.error(`Failed to get open positions count for wallet stats:`, error.message);
          // Don't throw - this is non-critical, will save with null
        }
      }

      // Save wallet-token pair to database (save first even if market data is empty)
      // Include open_position_count for BUY events
      await dbService.saveWalletTokenPair(walletAddress, tokenAddress, txType as 'BUY' | 'SELL', amount, marketData, openPositionCount);

    } catch (error: any) {
      console.error(`❌ Error tracking wallet-token pair:`, error.message);
    }
  }

  /**
   * Get all tokens traded by a wallet
   */
  async getWalletTokens(walletAddress: string, limit?: number, offset?: number): Promise<{ data: any[], total: number }> {
    try {
      return await dbService.getWalletTokens(walletAddress, limit, offset);
    } catch (error: any) {
      console.error(`❌ Error fetching wallet tokens:`, error.message);
      return { data: [], total: 0 };
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

