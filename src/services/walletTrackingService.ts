/**
 * Wallet Tracking Service
 * Tracks wallet-token pairs from buy/sell events
 * Separate from token info extraction module
 * 
 * Tracks:
 * - First Buy Timestamp & Amount
 * - First Sell Timestamp & Amount
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { dbService } from '../database';

interface MarketCapResult {
  success: boolean;
  marketCap?: number;
  tokenSupply?: number;
  tokenBalance?: number;
  solAmount?: number;
  tokenAddress?: string;
  error?: string;
}

export class WalletTrackingService {
  /**
   * Track wallet-token pair from buy/sell event
   * Records first buy/sell for a wallet-token pair
   * Uses marketcap from tracker (passed as marketCapResult) instead of fetching it
   */
  async trackWalletToken(
    walletAddress: string,
    tokenAddress: string,
    inAmount: string,
    outAmount: string,
    transactionType: string,
    marketCapResult: MarketCapResult | null = null
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
      
      // Build market data using marketcap from tracker (if available)
      let marketData: {
        supply: string | null;
        price: number | null;
        decimals: number | null;
        market_cap: number | null;
      } | null = null;
      
      let isEmptyData = false;

      // Use marketcap from tracker (marketCapResult) if available
      if (marketCapResult && marketCapResult.success && typeof marketCapResult.marketCap === 'number') {
        // Build market data using calculated marketcap from tracker
        marketData = {
          market_cap: marketCapResult.marketCap,
          supply: marketCapResult.tokenSupply ? marketCapResult.tokenSupply.toString() : null,
          price: null, // Not available from marketCapService calculation
          decimals: null // Not available from marketCapService calculation
        };
        console.log(`   MCap (from tracker): $${marketCapResult.marketCap}, Supply: ${marketData.supply || 'N/A'}`);
        
        // Still fetch price/decimals if needed (non-blocking, optional)
        dbService.fetchMcapFromSolscan(tokenAddress).then(fetchResult => {
          if (fetchResult && !fetchResult.isEmpty && marketData) {
            // Update price and decimals if available
            if (fetchResult.price !== null) marketData.price = fetchResult.price;
            if (fetchResult.decimals !== null) marketData.decimals = fetchResult.decimals;
            // Optionally update supply if more accurate
            if (fetchResult.supply) marketData.supply = fetchResult.supply;
            
            // Update wallet-token pair with price/decimals
            dbService.updateWalletTokenMarketData(
              walletAddress,
              tokenAddress,
              txType as 'BUY' | 'SELL',
              marketData
            ).catch(() => {
              // Silent fail for optional update
            });
          }
        }).catch(() => {
          // Silent fail for optional price/decimals fetch
        });
      } else {
        // Fallback: fetch market data if tracker didn't provide it
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
      }

      // Save wallet-token pair to database (save first even if market data is empty)
      await dbService.saveWalletTokenPair(walletAddress, tokenAddress, txType as 'BUY' | 'SELL', amount, marketData);

      // If this is a BUY event, record the open positions count
      if (txType === 'BUY') {
        // Get current open positions count for this wallet
        try {
          const shyftApiKey = process.env.SHYFT_API_KEY;
          let connection: Connection;
          
          if (shyftApiKey) {
            const shyftRpcUrl = `https://rpc.shyft.to?api_key=${shyftApiKey}`;
            connection = new Connection(shyftRpcUrl, 'confirmed');
          } else {
            const fallbackRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
            connection = new Connection(fallbackRpcUrl, 'confirmed');
          }
          
          const publicKey = new PublicKey(walletAddress);
          
          // Get parsed token accounts
          const parsedTokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
          });
          const parsed2022TokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
          });
          
          // Count only accounts with non-zero balance
          const openPositionsCount = parsedTokenAccounts.value.filter(account => {
            const parsedInfo = account.account.data.parsed?.info;
            if (parsedInfo && parsedInfo.tokenAmount) {
              return parseFloat(parsedInfo.tokenAmount.uiAmountString || '0') > 0;
            }
            return false;
          }).length + parsed2022TokenAccounts.value.filter(account => {
            const parsedInfo = account.account.data.parsed?.info;
            if (parsedInfo && parsedInfo.tokenAmount) {
              return parseFloat(parsedInfo.tokenAmount.uiAmountString || '0') > 0;
            }
            return false;
          }).length;
          
          // Update wallet stats (non-blocking)
          dbService.updateWalletStatsOnBuy(walletAddress, openPositionsCount).catch((error) => {
            console.error(`Failed to update wallet stats on buy:`, error);
          });
        } catch (error: any) {
          console.error(`Failed to get open positions count for wallet stats:`, error.message);
          // Don't throw - this is non-critical
        }
      }

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

