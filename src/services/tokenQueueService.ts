/**
 * Token Queue Service
 * Processes token information extraction independently from streaming
 * Uses a Set-based queue to avoid duplicate processing
 */

import { dbService } from '../database';
import { tokenService } from './tokenService';

interface TokenQueueItem {
  mintAddress: string;
  addedAt: number;
}

export class TokenQueueService {
  private queue: Set<string> = new Set();
  private processing: Set<string> = new Set();
  private isRunning: boolean = false;
  private shouldStop: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly PROCESS_INTERVAL_MS = 2000; // Process every 2 seconds
  private readonly MAX_CONCURRENT = 3; // Max concurrent token processing
  private shyftApiKey: string;

  constructor() {
    this.shyftApiKey = process.env.SHYFT_API_KEY || '';
    
    if (!this.shyftApiKey) {
      console.warn('⚠️ Warning: SHYFT_API_KEY not set in environment variables');
    }
  }

  /**
   * Add a token to the processing queue
   */
  async addToken(mintAddress: string): Promise<void> {
    // Skip if already in queue or processing
    if (this.queue.has(mintAddress) || this.processing.has(mintAddress)) {
      console.log(`🔄 Token ${mintAddress.substring(0, 8)}... already in queue/processing, skipping`);
      return;
    }

    // Check if token already exists in database
    const existingToken = await dbService.getToken(mintAddress);
    if (existingToken) {
      console.log(`✓ Token ${mintAddress.substring(0, 8)}... already exists in database, skipping`);
      return;
    }

    // Add to queue
    this.queue.add(mintAddress);
    console.log(`➕ Added token to queue: ${mintAddress.substring(0, 8)}... (Queue size: ${this.queue.size})`);
  }

  /**
   * Start processing the queue
   */
  start(): void {
    if (this.isRunning) {
      console.log('Token queue processor is already running');
      return;
    }

    this.isRunning = true;
    this.shouldStop = false;
    console.log('🚀 Token queue processor started');

    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, this.PROCESS_INTERVAL_MS);
  }

  /**
   * Stop processing the queue
   * Sets shouldStop flag to true, which will stop processing after all remaining items are processed
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.shouldStop) {
      // Already stopping
      return;
    }

    this.shouldStop = true;
    console.log('🛑 Token queue processor stop requested - will stop after processing remaining items');
    console.log(`   Queue: ${this.queue.size} pending, ${this.processing.size} processing`);
    
    // If queue is already empty and nothing is processing, stop immediately
    if (this.queue.size === 0 && this.processing.size === 0) {
      this.finishStop();
      return;
    }

    // Otherwise, let processQueue() handle the actual stop when queue and processing are empty
  }

  /**
   * Actually stop the queue processor
   */
  private finishStop(): void {
    this.isRunning = false;
    this.shouldStop = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    console.log('🛑 Token queue processor stopped');
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueSize: this.queue.size,
      processing: this.processing.size,
      isRunning: this.isRunning,
    };
  }

  /**
   * Process items in the queue
   */
  private async processQueue(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    // If should stop and queue/processing are empty, actually stop
    if (this.shouldStop && this.queue.size === 0 && this.processing.size === 0) {
      this.finishStop();
      return;
    }

    // If should stop, don't add new items to processing, but continue processing existing ones
    if (this.shouldStop && this.queue.size === 0) {
      return;
    }

    if (this.queue.size === 0 && !this.shouldStop) {
      return;
    }

    if (this.shouldStop) {
      console.log(`\n📋 Token queue: ${this.queue.size} pending, ${this.processing.size} processing (stopping after completion)`);
    } else {
      console.log(`\n📋 Token queue: ${this.queue.size} pending, ${this.processing.size} processing`);
    }

    // Don't start new processing if we're at max concurrent
    if (this.processing.size >= this.MAX_CONCURRENT) {
      return;
    }

    // Get next items to process
    const itemsToProcess = Math.min(
      this.MAX_CONCURRENT - this.processing.size,
      this.queue.size
    );

    if (itemsToProcess === 0) {
      return;
    }

    // Get items from queue
    const queueArray = Array.from(this.queue);
    const items = queueArray.slice(0, itemsToProcess);

    // Process each item
    for (const mintAddress of items) {
      // Remove from queue and add to processing
      this.queue.delete(mintAddress);
      this.processing.add(mintAddress);

      // Process token (non-blocking)
      this.processToken(mintAddress)
        .finally(() => {
          // Remove from processing when done
          this.processing.delete(mintAddress);
          
          // Check if we should stop after this item completes
          if (this.shouldStop && this.queue.size === 0 && this.processing.size === 0) {
            this.finishStop();
          }
        });
    }
  }

  /**
   * Process a single token
   */
  private async processToken(mintAddress: string): Promise<void> {
    try {
      console.log(`\n🔍 Processing token: ${mintAddress}`);

      let tokenMetadata = null;
      let creatorInfo = null;

      // Step 1: Fetch token metadata using Shyft API
      try {
        tokenMetadata = await this.fetchTokenMetadata(mintAddress);
        if (tokenMetadata) {
          console.log(`✅ Token metadata: ${tokenMetadata.name} (${tokenMetadata.symbol})`);
        } else {
          console.log(`❌ Failed to fetch metadata for token ${mintAddress.substring(0, 8)}...`);
        }
      } catch (error: any) {
        console.log(`❌ Error fetching metadata: ${error.message}`);
      }

      // Step 2: Fetch token creator info and dev buy amount
      try {
        creatorInfo = await tokenService.getTokenCreatorInfo(mintAddress);
        if (creatorInfo) {
          console.log(`✅ Creator info fetched successfully`);
        }
      } catch (error: any) {
        console.log(`⚠️ Could not fetch creator info for ${mintAddress.substring(0, 8)}...:`, error);
      }

      // Check if we have any information to save
      if (!tokenMetadata && !creatorInfo) {
        console.log(`❌ Failed to fetch token information. Not saving to database.`);
        return;
      }

      // Step 3: Save to database (only if we have at least some information)
      const tokenData = {
        mint_address: mintAddress,
        token_name: tokenMetadata?.name || null,
        symbol: tokenMetadata?.symbol || null,
        image: tokenMetadata?.image || null,
        creator: creatorInfo?.creator || null,
        dev_buy_amount: creatorInfo?.devBuyAmount || null,
        dev_buy_amount_decimal: creatorInfo?.devBuyAmountDecimal || null,
        dev_buy_used_token: creatorInfo?.devBuyUsedToken || null,
        dev_buy_token_amount: creatorInfo?.devBuyTokenAmount || null,
        dev_buy_token_amount_decimal: creatorInfo?.devBuyTokenAmountDecimal || null,
      };

      await dbService.saveToken(tokenData);
      console.log(`✅ Token ${mintAddress.substring(0, 8)}... processed and saved successfully`);
      console.log(`   - Metadata: ${tokenMetadata ? 'Yes' : 'No'}`);
      console.log(`   - Creator Info: ${creatorInfo ? 'Yes' : 'No'}`);

    } catch (error: any) {
      console.error(`❌ Error processing token ${mintAddress.substring(0, 8)}...:`, error.message);
    }
  }

  /**
   * Fetch token metadata using Shyft API
   */
  private async fetchTokenMetadata(mintAddress: string): Promise<{
    name: string;
    symbol: string;
    image: string | null;
  } | null> {
    try {
      const headers = new Headers();
      headers.append('x-api-key', this.shyftApiKey);

      const requestOptions: RequestInit = {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
      };

      const response = await fetch(
        `https://api.shyft.to/sol/v1/token/get_info?network=mainnet-beta&token_address=${mintAddress}`,
        requestOptions
      );

      if (!response.ok) {
        console.error(`Shyft API error: ${response.statusText}`);
        return null;
      }

      const data = await response.json();

      if (!data.success || !data.result) {
        console.error('Failed to fetch token metadata from Shyft');
        return null;
      }

      return {
        name: data.result.name || 'Unknown Token',
        symbol: data.result.symbol || '???',
        image: data.result.image || null,
      };
    } catch (error) {
      console.error('Failed to fetch token metadata:', error);
      return null;
    }
  }

  /**
   * Clear the queue (for testing/debugging)
   */
  clearQueue(): void {
    this.queue.clear();
    console.log('Queue cleared');
  }
}

// Export singleton instance
export const tokenQueueService = new TokenQueueService();

