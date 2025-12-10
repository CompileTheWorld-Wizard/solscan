import Redis from "ioredis";

/**
 * Redis Service for accessing price data
 */
class RedisService {
  private client: Redis | null = null;
  private isConnected: boolean = false;

  /**
   * Initialize Redis connection
   */
  initialize(): void {
    try {
      const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
      this.client = new Redis(redisUrl, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      this.client.on("connect", () => {
        console.log("✅ Redis connected");
        this.isConnected = true;
      });

      this.client.on("error", (error) => {
        console.error("❌ Redis connection error:", error.message);
        this.isConnected = false;
      });

      this.client.on("close", () => {
        console.log("⚠️ Redis connection closed");
        this.isConnected = false;
      });
    } catch (error: any) {
      console.error("❌ Failed to initialize Redis:", error?.message || error);
      this.isConnected = false;
    }
  }

  /**
   * Get latest SOL price from Redis sorted set
   * Key: "price:timeseries:So11111111111111111111111111111111111111112"
   * Returns the price_usd from the latest entry (highest score)
   */
  async getLatestSolPrice(): Promise<number | null> {
    if (!this.client || !this.isConnected) {
      console.warn("⚠️ Redis not connected, cannot fetch SOL price");
      return null;
    }

    try {
      const key = "price:timeseries:So11111111111111111111111111111111111111112";
      
      // Get the latest entry (highest score) from the sorted set
      // ZREVRANGE returns members with scores in descending order
      const result = await this.client.zrevrange(key, 0, 0, "WITHSCORES");
      
      if (!result || result.length === 0) {
        console.warn("⚠️ No SOL price data found in Redis");
        return null;
      }

      // result[0] is the member (JSON string), result[1] is the score (timestamp)
      const member = result[0];
      
      if (!member) {
        return null;
      }

      // Parse the JSON member
      const priceData = JSON.parse(member);
      
      // Extract price_usd field
      const priceUsd = priceData?.price_usd;
      
      if (priceUsd === null || priceUsd === undefined) {
        console.warn("⚠️ SOL price data missing price_usd field");
        return null;
      }

      const price = parseFloat(priceUsd.toString());
      
      if (isNaN(price)) {
        console.warn("⚠️ Invalid SOL price value in Redis");
        return null;
      }

      return price;
    } catch (error: any) {
      console.error("❌ Failed to fetch SOL price from Redis:", error?.message || error);
      return null;
    }
  }

  /**
   * Check if Redis is connected
   */
  isRedisConnected(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }
}

// Export singleton instance
export const redisService = new RedisService();

