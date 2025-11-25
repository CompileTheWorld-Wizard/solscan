import { Pool, PoolClient } from 'pg';

interface TransactionData {
  transaction_id: string;
  platform: string;
  type: string;
  mint_from: string;
  mint_to: string;
  in_amount: string;
  out_amount: string;
  feePayer: string;
  tipAmount?: number;
  feeAmount?: number;
  blockNumber?: number | null;
  blockTimestamp?: number | null;
  token_price_sol?: number | null;
  token_price_usd?: number | null;
  dev_still_holding?: boolean | null;
  mint_from_name?: string | null;
  mint_from_image?: string | null;
  mint_from_symbol?: string | null;
  mint_to_name?: string | null;
  mint_to_image?: string | null;
  mint_to_symbol?: string | null;
}

interface TokenData {
  mint_address: string;
  creator?: string;
  dev_buy_amount?: string;
  dev_buy_amount_decimal?: number;
  dev_buy_used_token?: string;
  dev_buy_token_amount?: string;
  dev_buy_token_amount_decimal?: number;
  dev_buy_timestamp?: number | null;
  dev_buy_block_number?: number | null;
  token_name?: string;
  symbol?: string;
  image?: string;
  twitter?: string;
  website?: string;
  discord?: string;
  telegram?: string;
  creator_token_count?: number | null;
}

interface SkipToken {
  id?: number;
  mint_address: string;
  symbol?: string;
  description?: string;
  created_at?: Date;
}

class DatabaseService {
  private pool: Pool;
  private isInitialized: boolean = false;

  constructor() {
    // Initialize connection pool with environment variables
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'solscan',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      max: 20, // Maximum number of clients in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }

  /**
   * Initialize the database (create table if not exists)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS transactions (
          id SERIAL PRIMARY KEY,
          transaction_id VARCHAR(100) UNIQUE NOT NULL,
          platform VARCHAR(50) NOT NULL,
          type VARCHAR(20) NOT NULL,
          mint_from VARCHAR(100) NOT NULL,
          mint_to VARCHAR(100) NOT NULL,
          in_amount NUMERIC(40, 0) NOT NULL,
          out_amount NUMERIC(40, 0) NOT NULL,
          fee_payer VARCHAR(100) NOT NULL,
          tip_amount NUMERIC(20, 9),
          fee_amount NUMERIC(20, 9),
          market_cap NUMERIC(20, 2),
          total_supply NUMERIC(40, 0),
          block_number BIGINT,
          block_timestamp TIMESTAMP,
          dev_still_holding BOOLEAN,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        -- Add dev_still_holding column if it doesn't exist (for existing databases)
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'transactions' AND column_name = 'dev_still_holding'
          ) THEN
            ALTER TABLE transactions ADD COLUMN dev_still_holding BOOLEAN;
          END IF;
        END $$;

        CREATE INDEX IF NOT EXISTS idx_transaction_id ON transactions(transaction_id);
        CREATE INDEX IF NOT EXISTS idx_platform ON transactions(platform);
        CREATE INDEX IF NOT EXISTS idx_created_at ON transactions(created_at);
        CREATE INDEX IF NOT EXISTS idx_fee_payer ON transactions(fee_payer);
        CREATE INDEX IF NOT EXISTS idx_block_number ON transactions(block_number);
        CREATE INDEX IF NOT EXISTS idx_block_timestamp ON transactions(block_timestamp);

        CREATE TABLE IF NOT EXISTS tokens (
          id SERIAL PRIMARY KEY,
          mint_address VARCHAR(100) UNIQUE NOT NULL,
          creator VARCHAR(100),
          dev_buy_amount VARCHAR(100),
          dev_buy_amount_decimal INTEGER,
          dev_buy_used_token VARCHAR(100),
          dev_buy_token_amount VARCHAR(100),
          dev_buy_token_amount_decimal INTEGER,
          dev_buy_timestamp TIMESTAMP,
          dev_buy_block_number BIGINT,
          token_name VARCHAR(200),
          symbol VARCHAR(50),
          image TEXT,
          twitter TEXT,
          website TEXT,
          discord TEXT,
          telegram TEXT,
          creator_token_count INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        -- Add creator_token_count column if it doesn't exist (for existing databases)
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'tokens' AND column_name = 'creator_token_count'
          ) THEN
            ALTER TABLE tokens ADD COLUMN creator_token_count INTEGER;
          END IF;
        END $$;

        CREATE INDEX IF NOT EXISTS idx_mint_address ON tokens(mint_address);
        CREATE INDEX IF NOT EXISTS idx_creator ON tokens(creator);
        CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at);
        CREATE INDEX IF NOT EXISTS idx_dev_buy_timestamp ON tokens(dev_buy_timestamp);
        CREATE INDEX IF NOT EXISTS idx_dev_buy_block_number ON tokens(dev_buy_block_number);

        CREATE TABLE IF NOT EXISTS skip_tokens (
          id SERIAL PRIMARY KEY,
          mint_address VARCHAR(100) UNIQUE NOT NULL,
          symbol VARCHAR(50),
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_skip_mint_address ON skip_tokens(mint_address);

        CREATE TABLE IF NOT EXISTS wallets (
          id SERIAL PRIMARY KEY,
          wallet_address VARCHAR(100) NOT NULL,
          token_address VARCHAR(100) NOT NULL,
          first_buy_timestamp TIMESTAMP,
          first_buy_amount VARCHAR(100),
          first_buy_mcap NUMERIC(20, 2),
          first_buy_supply VARCHAR(100),
          first_buy_price NUMERIC(20, 8),
          first_sell_timestamp TIMESTAMP,
          first_sell_amount VARCHAR(100),
          first_sell_mcap NUMERIC(20, 2),
          first_sell_supply VARCHAR(100),
          first_sell_price NUMERIC(20, 8),
          price_timeseries JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(wallet_address, token_address)
        );

        CREATE INDEX IF NOT EXISTS idx_wallet_address ON wallets(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_token_address ON wallets(token_address);
        CREATE INDEX IF NOT EXISTS idx_wallet_token ON wallets(wallet_address, token_address);
        CREATE INDEX IF NOT EXISTS idx_wallets_first_buy ON wallets(first_buy_timestamp);
        CREATE INDEX IF NOT EXISTS idx_wallets_first_sell ON wallets(first_sell_timestamp);

        -- Drop wallet_stats table if it exists (no longer used)
        DROP TABLE IF EXISTS wallet_stats;

        CREATE TABLE IF NOT EXISTS credentials (
          id SERIAL PRIMARY KEY,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS dashboard_filter_presets (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          filters_json JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_filter_preset_name ON dashboard_filter_presets(name);
        
        -- Migration: Convert old format to new format and remove old columns
        DO $$ 
        BEGIN
          -- Add filters_json column if it doesn't exist
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'dashboard_filter_presets' 
            AND column_name = 'filters_json'
          ) THEN
            ALTER TABLE dashboard_filter_presets ADD COLUMN filters_json JSONB;
            
            -- Migrate old format data to new format
            UPDATE dashboard_filter_presets
            SET filters_json = jsonb_build_array(
              CASE 
                WHEN dev_buy_size_min IS NOT NULL OR dev_buy_size_max IS NOT NULL THEN
                  jsonb_build_object(
                    'key', 'devBuyAmountSOL',
                    'label', 'Dev Buy Amount in SOL',
                    'type', 'sol',
                    'min', dev_buy_size_min,
                    'max', dev_buy_size_max,
                    'minEnabled', true,
                    'maxEnabled', true
                  )
                ELSE NULL
              END,
              CASE 
                WHEN buy_size_min IS NOT NULL OR buy_size_max IS NOT NULL THEN
                  jsonb_build_object(
                    'key', 'walletBuyAmountSOL',
                    'label', 'Wallet Buy Amount in SOL',
                    'type', 'sol',
                    'min', buy_size_min,
                    'max', buy_size_max,
                    'minEnabled', true,
                    'maxEnabled', true
                  )
                ELSE NULL
              END,
              CASE 
                WHEN pnl_min IS NOT NULL OR pnl_max IS NOT NULL THEN
                  jsonb_build_object(
                    'key', 'pnlPercent',
                    'label', '% PNL per token',
                    'type', 'percent',
                    'min', pnl_min,
                    'max', pnl_max,
                    'minEnabled', true,
                    'maxEnabled', true
                  )
                ELSE NULL
              END
            )
            WHERE filters_json IS NULL;
            
            -- Remove NULL entries from array
            UPDATE dashboard_filter_presets
            SET filters_json = (
              SELECT jsonb_agg(elem)
              FROM jsonb_array_elements(filters_json) elem
              WHERE elem IS NOT NULL
            )
            WHERE filters_json IS NOT NULL;
          END IF;
          
          -- Remove old columns if they exist (for existing databases)
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'dashboard_filter_presets' 
            AND column_name = 'dev_buy_size_min'
          ) THEN
            ALTER TABLE dashboard_filter_presets DROP COLUMN IF EXISTS dev_buy_size_min;
            ALTER TABLE dashboard_filter_presets DROP COLUMN IF EXISTS dev_buy_size_max;
            ALTER TABLE dashboard_filter_presets DROP COLUMN IF EXISTS buy_size_min;
            ALTER TABLE dashboard_filter_presets DROP COLUMN IF EXISTS buy_size_max;
            ALTER TABLE dashboard_filter_presets DROP COLUMN IF EXISTS pnl_min;
            ALTER TABLE dashboard_filter_presets DROP COLUMN IF EXISTS pnl_max;
          END IF;
        END $$;
      `;

      await this.pool.query(createTableQuery);

      // Migration: Add total_supply column if it doesn't exist (for existing databases)
      try {
        const hasTotalSupply = await this.columnExists('transactions', 'total_supply');
        if (!hasTotalSupply) {
          await this.pool.query(`
            ALTER TABLE transactions 
            ADD COLUMN total_supply NUMERIC(40, 0)
          `);
          console.log('✅ Added total_supply column to transactions table');
        }
      } catch (error) {
        console.warn('⚠️ Failed to add total_supply column (may already exist):', error);
      }

      // Migration: Add token_price_sol and token_price_usd columns if they don't exist
      try {
        const hasTokenPriceSol = await this.columnExists('transactions', 'token_price_sol');
        if (!hasTokenPriceSol) {
          await this.pool.query(`
            ALTER TABLE transactions 
            ADD COLUMN token_price_sol NUMERIC(20, 9)
          `);
          console.log('✅ Added token_price_sol column to transactions table');
        }
      } catch (error) {
        console.warn('⚠️ Failed to add token_price_sol column (may already exist):', error);
      }

      try {
        const hasTokenPriceUsd = await this.columnExists('transactions', 'token_price_usd');
        if (!hasTokenPriceUsd) {
          await this.pool.query(`
            ALTER TABLE transactions 
            ADD COLUMN token_price_usd NUMERIC(20, 9)
          `);
          console.log('✅ Added token_price_usd column to transactions table');
        }
      } catch (error) {
        console.warn('⚠️ Failed to add token_price_usd column (may already exist):', error);
      }

      // Migration: Add peak price columns to wallets table
      try {
        const hasPeakBuyToSellPriceSol = await this.columnExists('wallets', 'peak_buy_to_sell_price_sol');
        if (!hasPeakBuyToSellPriceSol) {
          await this.pool.query(`
            ALTER TABLE wallets 
            ADD COLUMN peak_buy_to_sell_price_sol NUMERIC(20, 9),
            ADD COLUMN peak_buy_to_sell_price_usd NUMERIC(20, 9),
            ADD COLUMN peak_buy_to_sell_mcap NUMERIC(20, 2),
            ADD COLUMN peak_sell_to_end_price_sol NUMERIC(20, 9),
            ADD COLUMN peak_sell_to_end_price_usd NUMERIC(20, 9),
            ADD COLUMN peak_sell_to_end_mcap NUMERIC(20, 2)
          `);
          console.log('✅ Added peak price columns to wallets table');
        }
      } catch (error) {
        console.warn('⚠️ Failed to add peak price columns (may already exist):', error);
      }

      // Migration: Add open_position_count column to wallets table if it doesn't exist
      try {
        const hasOpenPositionCount = await this.columnExists('wallets', 'open_position_count');
        if (!hasOpenPositionCount) {
          await this.pool.query(`
            ALTER TABLE wallets 
            ADD COLUMN open_position_count INTEGER
          `);
          console.log('✅ Added open_position_count column to wallets table');
        }
      } catch (error) {
        console.warn('⚠️ Failed to add open_position_count column (may already exist):', error);
      }

      // Migration: Add price_timeseries JSONB column to wallets table if it doesn't exist
      try {
        const hasPriceTimeseries = await this.columnExists('wallets', 'price_timeseries');
        if (!hasPriceTimeseries) {
          await this.pool.query(`
            ALTER TABLE wallets 
            ADD COLUMN price_timeseries JSONB DEFAULT '[]'::jsonb
          `);
          console.log('✅ Added price_timeseries JSONB column to wallets table');
        }
      } catch (error) {
        console.warn('⚠️ Failed to add price_timeseries column (may already exist):', error);
      }

      // Migration: Add buy count columns to wallets table if they don't exist
      try {
        const hasBuysBeforeFirstSell = await this.columnExists('wallets', 'buys_before_first_sell');
        if (!hasBuysBeforeFirstSell) {
          await this.pool.query(`
            ALTER TABLE wallets 
            ADD COLUMN buys_before_first_sell INTEGER DEFAULT 0,
            ADD COLUMN buys_after_first_sell INTEGER DEFAULT 0
          `);
          console.log('✅ Added buy count columns (buys_before_first_sell, buys_after_first_sell) to wallets table');
        }
      } catch (error) {
        console.warn('⚠️ Failed to add buy count columns (may already exist):', error);
      }

      this.isInitialized = true;
      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Save transaction data to PostgreSQL asynchronously
   * This function does not block the main process
   */
  async saveTransaction(
    transactionId: string,
    transactionData: Omit<TransactionData, 'transaction_id'>
  ): Promise<void> {
    // Use setImmediate to ensure this is truly async and non-blocking
    setImmediate(async () => {
      try {
        // Convert block timestamp from Unix timestamp (seconds) to PostgreSQL TIMESTAMP
        const blockTimestamp = transactionData.blockTimestamp
          ? new Date(transactionData.blockTimestamp * 1000).toISOString()
          : null;

        const query = `
          INSERT INTO transactions (
            transaction_id,
            platform,
            type,
            mint_from,
            mint_to,
            in_amount,
            out_amount,
            fee_payer,
            tip_amount,
            fee_amount,
            block_number,
            block_timestamp,
            token_price_sol,
            token_price_usd,
            dev_still_holding
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (transaction_id) DO UPDATE SET
            dev_still_holding = EXCLUDED.dev_still_holding
        `;

        const values = [
          transactionId,
          transactionData.platform,
          transactionData.type,
          transactionData.mint_from,
          transactionData.mint_to,
          transactionData.in_amount?.toString() || '0',
          transactionData.out_amount?.toString() || '0',
          transactionData.feePayer,
          transactionData.tipAmount ?? null,
          transactionData.feeAmount ?? null,
          transactionData.blockNumber ?? null,
          blockTimestamp,
          transactionData.token_price_sol ?? null,
          transactionData.token_price_usd ?? null,
          transactionData.dev_still_holding ?? null,
        ];

        await this.pool.query(query, values);
        console.log(`💾 Transaction saved to DB: ${transactionId}`);
      } catch (error: any) {
        // Only log errors that aren't duplicate key conflicts
        if (error.code !== '23505') {
          console.error(`❌ Failed to save transaction ${transactionId}:`, error.message);
        }
      }
    });
  }

  /**
   * Update market_cap, total_supply, token_price_sol, and token_price_usd for a transaction by signature
   */
  async updateTransactionMarketCap(
    transactionId: string,
    marketCap: number | null,
    totalSupply?: number | null,
    tokenPriceSol?: number | null,
    tokenPriceUsd?: number | null
  ): Promise<void> {
    try {
      const query = `
        UPDATE transactions
        SET market_cap = $2, 
            total_supply = $3,
            token_price_sol = $4,
            token_price_usd = $5
        WHERE transaction_id = $1
      `;
      await this.pool.query(query, [
        transactionId,
        marketCap,
        totalSupply ?? null,
        tokenPriceSol ?? null,
        tokenPriceUsd ?? null
      ]);
      console.log(`💾 Market cap, total supply, and token prices updated for tx: ${transactionId}`);
    } catch (error: any) {
      console.error(`❌ Failed to update market cap for ${transactionId}:`, error.message);
    }
  }

  /**
   * Update dev_still_holding for a transaction by signature
   */
  async updateTransactionDevHolding(
    transactionId: string,
    devStillHolding: boolean
  ): Promise<void> {
    try {
      const query = `
        UPDATE transactions
        SET dev_still_holding = $2
        WHERE transaction_id = $1
      `;
      await this.pool.query(query, [transactionId, devStillHolding]);
      console.log(`💾 Dev still holding updated for tx: ${transactionId} = ${devStillHolding}`);
    } catch (error: any) {
      console.error(`❌ Failed to update dev_still_holding for ${transactionId}:`, error.message);
    }
  }

  /**
   * Close the database connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
    console.log('Database connection pool closed');
  }

  /**
   * Get pool statistics
   */
  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Get SOL price (USD) from solPrice table
   * Note: solPrice table only has price field (no time field)
   */
  async getLatestSolPrice(): Promise<number | null> {
    try {
      const query = `
        SELECT price
        FROM solPrice
        LIMIT 1
      `;
      const result = await this.pool.query(query);
      if (result.rows.length === 0) {
        return null;
      }
      const raw = result.rows[0].price;
      const price = raw !== null && raw !== undefined ? parseFloat(raw.toString()) : NaN;
      return Number.isNaN(price) ? null : price;
    } catch (error) {
      console.error('Failed to fetch SOL price:', error);
      return null;
    }
  }

  /**
   * Get recent transactions with pagination and optional date/wallet filtering
   */
  async getTransactions(
    limit: number = 50,
    offset: number = 0,
    fromDate?: string,
    toDate?: string,
    walletAddresses?: string[] | null
  ): Promise<TransactionData[]> {
    try {
      let query = `
        SELECT 
          t.transaction_id,
          t.platform,
          t.type,
          t.mint_from,
          t.mint_to,
          t.in_amount,
          t.out_amount,
          t.fee_payer as "feePayer",
          t.tip_amount as "tipAmount",
          t.fee_amount as "feeAmount",
          t.market_cap as "marketCap",
          t.block_number as "blockNumber",
          t.created_at,
          token_from.token_name as "mint_from_name",
          token_from.image as "mint_from_image",
          token_from.symbol as "mint_from_symbol",
          token_to.token_name as "mint_to_name",
          token_to.image as "mint_to_image",
          token_to.symbol as "mint_to_symbol"
        FROM transactions t
        LEFT JOIN tokens token_from ON t.mint_from = token_from.mint_address
        LEFT JOIN tokens token_to ON t.mint_to = token_to.mint_address
      `;

      const params: any[] = [];
      const conditions: string[] = [];
      let paramCount = 0;

      // Add wallet filter if provided
      if (walletAddresses && walletAddresses.length > 0) {
        paramCount++;
        const placeholders = walletAddresses.map((_, i) => `$${paramCount + i}`).join(', ');
        conditions.push(`t.fee_payer IN (${placeholders})`);
        params.push(...walletAddresses);
        paramCount += walletAddresses.length - 1;
      }

      // Add date filters if provided
      if (fromDate) {
        paramCount++;
        conditions.push(`t.created_at >= $${paramCount}`);
        params.push(fromDate);
      }

      if (toDate) {
        paramCount++;
        // Add end of day to include the entire toDate
        conditions.push(`t.created_at <= $${paramCount}`);
        params.push(`${toDate} 23:59:59`);
      }

      // Add WHERE clause if there are conditions
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      // Always sort by most recent first
      query += ' ORDER BY t.created_at DESC';

      // Add pagination
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);

      paramCount++;
      query += ` OFFSET $${paramCount}`;
      params.push(offset);

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
      throw error;
    }
  }

  /**
   * Get total transaction count with optional date/wallet filtering
   */
  async getTransactionCount(fromDate?: string, toDate?: string, walletAddresses?: string[] | null): Promise<number> {
    try {
      let query = 'SELECT COUNT(*) as count FROM transactions t';
      const params: any[] = [];
      const conditions: string[] = [];
      let paramCount = 0;

      // Add wallet filter if provided
      if (walletAddresses && walletAddresses.length > 0) {
        paramCount++;
        const placeholders = walletAddresses.map((_, i) => `$${paramCount + i}`).join(', ');
        conditions.push(`t.fee_payer IN (${placeholders})`);
        params.push(...walletAddresses);
        paramCount += walletAddresses.length - 1;
      }

      // Add date filters if provided
      if (fromDate) {
        paramCount++;
        conditions.push(`t.created_at >= $${paramCount}`);
        params.push(fromDate);
      }

      if (toDate) {
        paramCount++;
        conditions.push(`t.created_at <= $${paramCount}`);
        params.push(`${toDate} 23:59:59`);
      }

      // Add WHERE clause if there are conditions
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      const result = await this.pool.query(query, params);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Failed to get transaction count:', error);
      return 0;
    }
  }

  /**
   * Get trading activity aggregated by time interval for a wallet
   * @param walletAddress - The wallet address
   * @param interval - Time interval: 'hour', 'quarter_day', 'day', 'week', 'month'
   * @returns Array of aggregated data points
   */
  async getWalletTradingActivity(
    walletAddress: string,
    interval: 'hour' | 'quarter_day' | 'day' | 'week' | 'month'
  ): Promise<Array<{ period: string; buys: number; sells: number; total: number; pnlPercent: number }>> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const SOL_DECIMALS = 9;
      let dateFormat: string;
      let groupBy: string;

      switch (interval) {
        case 'hour':
          dateFormat = 'YYYY-MM-DD HH24:00';
          groupBy = "DATE_TRUNC('hour', created_at)";
          break;
        case 'quarter_day':
          // Morning (06-12), Afternoon (12-18), Evening (18-24), Night (00-06)
          dateFormat = 'YYYY-MM-DD';
          groupBy = `DATE(created_at) || ' ' || CASE 
            WHEN EXTRACT(HOUR FROM created_at) >= 6 AND EXTRACT(HOUR FROM created_at) < 12 THEN 'Morning'
            WHEN EXTRACT(HOUR FROM created_at) >= 12 AND EXTRACT(HOUR FROM created_at) < 18 THEN 'Afternoon'
            WHEN EXTRACT(HOUR FROM created_at) >= 18 AND EXTRACT(HOUR FROM created_at) < 24 THEN 'Evening'
            ELSE 'Night'
          END`;
          break;
        case 'day':
          dateFormat = 'YYYY-MM-DD';
          groupBy = "TO_CHAR(DATE(created_at), 'YYYY-MM-DD')";
          break;
        case 'week':
          dateFormat = 'YYYY-"W"IW';
          groupBy = "TO_CHAR(DATE_TRUNC('week', created_at), 'YYYY-\"W\"IW')";
          break;
        case 'month':
          dateFormat = 'YYYY-MM';
          groupBy = "TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM')";
          break;
        default:
          dateFormat = 'YYYY-MM-DD';
          groupBy = "DATE(created_at)";
      }

      const query = `
        SELECT 
          ${groupBy} as period,
          COUNT(*) FILTER (WHERE LOWER(type) = 'buy') as buys,
          COUNT(*) FILTER (WHERE LOWER(type) = 'sell') as sells,
          COUNT(*) as total,
          COALESCE(SUM(CASE 
            WHEN LOWER(type) = 'buy' AND mint_from = $2 
            THEN in_amount::numeric / POWER(10, $3)
            ELSE 0 
          END), 0) as total_buy_amount_sol,
          COALESCE(SUM(CASE 
            WHEN LOWER(type) = 'sell' AND mint_to = $2 
            THEN out_amount::numeric / POWER(10, $3)
            ELSE 0 
          END), 0) as total_sell_amount_sol,
          COALESCE(SUM(COALESCE(tip_amount, 0) + COALESCE(fee_amount, 0)), 0) as total_gas_fees
        FROM transactions
        WHERE fee_payer = $1
        GROUP BY ${groupBy}
        ORDER BY period ASC
      `;

      const result = await this.pool.query(query, [walletAddress, SOL_MINT, SOL_DECIMALS]);

      return result.rows.map((row: any) => {
        // Handle period - convert Date objects to string format
        let periodStr = '';
        if (row.period) {
          if (row.period instanceof Date) {
            // If it's a Date object, format it based on interval
            const date = row.period;
            switch (interval) {
              case 'hour':
                const hour = String(date.getUTCHours()).padStart(2, '0');
                const minute = String(date.getUTCMinutes()).padStart(2, '0');
                const year = date.getUTCFullYear();
                const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                const day = String(date.getUTCDate()).padStart(2, '0');
                periodStr = `${year}-${month}-${day} ${hour}:${minute}`;
                break;
              case 'day':
                const dYear = date.getUTCFullYear();
                const dMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
                const dDay = String(date.getUTCDate()).padStart(2, '0');
                periodStr = `${dYear}-${dMonth}-${dDay}`;
                break;
              case 'month':
                const mYear = date.getUTCFullYear();
                const mMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
                periodStr = `${mYear}-${mMonth}`;
                break;
              default:
                periodStr = String(row.period);
            }
          } else {
            periodStr = String(row.period);
          }
        }

        // Calculate PNL %
        const totalBuyAmountSOL = parseFloat(row.total_buy_amount_sol) || 0;
        const totalSellAmountSOL = parseFloat(row.total_sell_amount_sol) || 0;
        const totalGasFees = parseFloat(row.total_gas_fees) || 0;
        const pnlSOL = totalSellAmountSOL - (totalBuyAmountSOL + totalGasFees);
        const pnlPercent = totalBuyAmountSOL > 0 ? (pnlSOL / totalBuyAmountSOL) * 100 : 0;

        return {
          period: periodStr,
          buys: parseInt(row.buys) || 0,
          sells: parseInt(row.sells) || 0,
          total: parseInt(row.total) || 0,
          pnlPercent: pnlPercent
        };
      });
    } catch (error) {
      console.error('Failed to get trading activity for wallet:', error);
      return [];
    }
  }

  /**
   * Get buy and sell transaction counts for a wallet
   */
  async getWalletBuySellCounts(walletAddress: string): Promise<{ totalBuys: number; totalSells: number }> {
    try {
      const query = `
        SELECT 
          type,
          COUNT(*) as count
        FROM transactions
        WHERE fee_payer = $1 AND (LOWER(type) = 'buy' OR LOWER(type) = 'sell')
        GROUP BY type
      `;

      const result = await this.pool.query(query, [walletAddress]);

      let totalBuys = 0;
      let totalSells = 0;

      result.rows.forEach((row: any) => {
        if (row.type?.toLowerCase() === 'buy') {
          totalBuys = parseInt(row.count);
        } else if (row.type?.toLowerCase() === 'sell') {
          totalSells = parseInt(row.count);
        }
      });

      return { totalBuys, totalSells };
    } catch (error) {
      console.error('Failed to get buy/sell counts for wallet:', error);
      return { totalBuys: 0, totalSells: 0 };
    }
  }

  /**
   * Update wallet stats when a buy event occurs
   * Increments buy_event_count and adds current open positions to open_position_total
   */
  /**
   * Get average open position for a wallet
   * Returns: average of all open_position_count values for buy events
   */
  async getWalletAverageOpenPosition(walletAddress: string): Promise<number> {
    try {
      const query = `
        SELECT 
          AVG(open_position_count) as avg_open_position
        FROM wallets
        WHERE wallet_address = $1
          AND open_position_count IS NOT NULL
      `;
      const result = await this.pool.query(query, [walletAddress]);

      if (result.rows.length === 0 || !result.rows[0].avg_open_position) {
        return 0;
      }

      return parseFloat(result.rows[0].avg_open_position) || 0;
    } catch (error) {
      console.error('Failed to get wallet average open position:', error);
      return 0;
    }
  }

  /**
   * Get the earliest transaction timestamp for a wallet (used as tracking start time)
   */
  async getEarliestTransactionForWallet(walletAddress: string): Promise<{ created_at: string } | null> {
    try {
      const query = `
        SELECT created_at
        FROM transactions
        WHERE fee_payer = $1
        ORDER BY created_at ASC
        LIMIT 1
      `;

      const result = await this.pool.query(query, [walletAddress]);
      if (result.rows.length === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      console.error('Failed to get earliest transaction for wallet:', error);
      return null;
    }
  }

  /**
   * Get all transactions for a specific wallet and token pair
   */
  async getTransactionsByWalletToken(walletAddress: string, tokenAddress: string): Promise<any[]> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const query = `
        SELECT 
          t.transaction_id,
          t.platform,
          t.type,
          t.mint_from,
          t.mint_to,
          t.in_amount,
          t.out_amount,
          t.fee_payer as "feePayer",
          t.tip_amount as "tipAmount",
          t.fee_amount as "feeAmount",
          t.market_cap as "marketCap",
          t.total_supply as "totalSupply",
          t.block_number as "blockNumber",
          t.block_timestamp as "blockTimestamp",
          t.dev_still_holding as "devStillHolding",
          t.created_at
        FROM transactions t
        WHERE t.fee_payer = $1
          AND (
            (t.mint_from = $2 AND t.mint_to = $3) OR
            (t.mint_from = $3 AND t.mint_to = $2)
          )
        ORDER BY COALESCE(t.block_timestamp, t.created_at) ASC
      `;

      const result = await this.pool.query(query, [walletAddress, tokenAddress, SOL_MINT]);
      return result.rows;
    } catch (error) {
      console.error('Failed to get transactions by wallet and token:', error);
      throw error;
    }
  }

  /**
   * Save token data to PostgreSQL
   */
  async saveToken(tokenData: TokenData): Promise<void> {
    try {
      // Check if social link columns exist
      const hasTwitter = await this.columnExists('tokens', 'twitter');
      const hasWebsite = await this.columnExists('tokens', 'website');
      const hasDiscord = await this.columnExists('tokens', 'discord');
      const hasTelegram = await this.columnExists('tokens', 'telegram');

      // Build columns and values dynamically
      const columns: string[] = [
        'mint_address',
        'creator',
        'dev_buy_amount',
        'dev_buy_amount_decimal',
        'dev_buy_used_token',
        'dev_buy_token_amount',
        'dev_buy_token_amount_decimal',
        'dev_buy_timestamp',
        'dev_buy_block_number',
        'token_name',
        'symbol',
        'image',
      ];

      // Convert timestamp from milliseconds to PostgreSQL TIMESTAMP
      const devBuyTimestamp = tokenData.dev_buy_timestamp
        ? new Date(tokenData.dev_buy_timestamp).toISOString()
        : null;

      const values: any[] = [
        tokenData.mint_address,
        tokenData.creator || null,
        tokenData.dev_buy_amount || null,
        tokenData.dev_buy_amount_decimal || null,
        tokenData.dev_buy_used_token || null,
        tokenData.dev_buy_token_amount || null,
        tokenData.dev_buy_token_amount_decimal || null,
        devBuyTimestamp,
        tokenData.dev_buy_block_number || null,
        tokenData.token_name || null,
        tokenData.symbol || null,
        tokenData.image || null,
      ];

      // Add social links if columns exist
      if (hasTwitter) {
        columns.push('twitter');
        values.push(tokenData.twitter || null);
      }
      if (hasWebsite) {
        columns.push('website');
        values.push(tokenData.website || null);
      }
      if (hasDiscord) {
        columns.push('discord');
        values.push(tokenData.discord || null);
      }
      if (hasTelegram) {
        columns.push('telegram');
        values.push(tokenData.telegram || null);
      }

      columns.push('updated_at');

      // Build placeholders (exclude updated_at from parameter count)
      const paramCount = columns.length - 1; // Exclude updated_at
      const placeholders = columns.map((col, index) => {
        if (col === 'updated_at') {
          return 'CURRENT_TIMESTAMP';
        }
        return `$${index + 1}`;
      }).join(', ');

      // Build UPDATE clause
      const updateClauses: string[] = [
        'creator = COALESCE(EXCLUDED.creator, tokens.creator)',
        'dev_buy_amount = COALESCE(EXCLUDED.dev_buy_amount, tokens.dev_buy_amount)',
        'dev_buy_amount_decimal = COALESCE(EXCLUDED.dev_buy_amount_decimal, tokens.dev_buy_amount_decimal)',
        'dev_buy_used_token = COALESCE(EXCLUDED.dev_buy_used_token, tokens.dev_buy_used_token)',
        'dev_buy_token_amount = COALESCE(EXCLUDED.dev_buy_token_amount, tokens.dev_buy_token_amount)',
        'dev_buy_token_amount_decimal = COALESCE(EXCLUDED.dev_buy_token_amount_decimal, tokens.dev_buy_token_amount_decimal)',
        'dev_buy_timestamp = COALESCE(EXCLUDED.dev_buy_timestamp, tokens.dev_buy_timestamp)',
        'dev_buy_block_number = COALESCE(EXCLUDED.dev_buy_block_number, tokens.dev_buy_block_number)',
        'token_name = COALESCE(EXCLUDED.token_name, tokens.token_name)',
        'symbol = COALESCE(EXCLUDED.symbol, tokens.symbol)',
        'image = COALESCE(EXCLUDED.image, tokens.image)',
      ];

      if (hasTwitter) {
        updateClauses.push('twitter = COALESCE(EXCLUDED.twitter, tokens.twitter)');
      }
      if (hasWebsite) {
        updateClauses.push('website = COALESCE(EXCLUDED.website, tokens.website)');
      }
      if (hasDiscord) {
        updateClauses.push('discord = COALESCE(EXCLUDED.discord, tokens.discord)');
      }
      if (hasTelegram) {
        updateClauses.push('telegram = COALESCE(EXCLUDED.telegram, tokens.telegram)');
      }

      updateClauses.push('updated_at = CURRENT_TIMESTAMP');

      const query = `
        INSERT INTO tokens (
          ${columns.join(', ')}
        ) VALUES (${placeholders})
        ON CONFLICT (mint_address) 
        DO UPDATE SET
          ${updateClauses.join(',\n          ')}
      `;

      await this.pool.query(query, values);
      console.log(`💾 Token info saved to DB: ${tokenData.mint_address}`);
    } catch (error: any) {
      console.error(`❌ Failed to save token ${tokenData.mint_address}:`, error.message);
      throw error;
    }
  }

  /**
   * Update creator token count for a token
   */
  async updateCreatorTokenCount(tokenAddress: string, creatorAddress: string, tokenCount: number): Promise<void> {
    try {
      // Check if creator_token_count column exists
      const hasCreatorTokenCount = await this.columnExists('tokens', 'creator_token_count');
      
      if (!hasCreatorTokenCount) {
        console.log(`⚠️ creator_token_count column does not exist, skipping update`);
        return;
      }

      // Update the token's creator_token_count by mint_address only
      // Also update creator if it's not set or different
      const query = `
        UPDATE tokens
        SET 
          creator_token_count = $1,
          creator = COALESCE(creator, $3),
          updated_at = CURRENT_TIMESTAMP
        WHERE mint_address = $2
      `;

      const result = await this.pool.query(query, [tokenCount, tokenAddress, creatorAddress]);
      
      if (result.rowCount === 0) {
        console.log(`⚠️ Token ${tokenAddress.substring(0, 8)}... not found in database, cannot update creator_token_count`);
      } else {
        console.log(`💾 Updated creator_token_count for token ${tokenAddress.substring(0, 8)}... (creator: ${creatorAddress.substring(0, 8)}..., count: ${tokenCount})`);
      }
    } catch (error: any) {
      console.error(`❌ Failed to update creator_token_count for ${tokenAddress}:`, error.message);
      // Don't throw - this is a non-critical update
    }
  }

  /**
   * Get token data by mint address
   */
  async getToken(mintAddress: string): Promise<TokenData | null> {
    try {
      const query = `
        SELECT 
          mint_address,
          creator,
          dev_buy_amount,
          dev_buy_amount_decimal,
          dev_buy_used_token,
          dev_buy_token_amount,
          dev_buy_token_amount_decimal,
          dev_buy_timestamp,
          dev_buy_block_number,
          token_name,
          symbol,
          image,
          twitter,
          website,
          discord,
          telegram,
          creator_token_count,
          created_at,
          updated_at
        FROM tokens
        WHERE mint_address = $1
      `;

      const result = await this.pool.query(query, [mintAddress]);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      console.error(`Failed to fetch token ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Get tokens by multiple mint addresses
   */
  async getTokensByMints(mintAddresses: string[]): Promise<TokenData[]> {
    if (mintAddresses.length === 0) {
      return [];
    }

    try {
      const query = `
        SELECT 
          mint_address,
          creator,
          dev_buy_amount,
          dev_buy_amount_decimal,
          dev_buy_used_token,
          dev_buy_token_amount,
          dev_buy_token_amount_decimal,
          dev_buy_timestamp,
          dev_buy_block_number,
          token_name,
          symbol,
          image,
          twitter,
          website,
          discord,
          telegram,
          creator_token_count,
          created_at,
          updated_at
        FROM tokens
        WHERE mint_address = ANY($1)
      `;

      const result = await this.pool.query(query, [mintAddresses]);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch tokens by mints:', error);
      return [];
    }
  }

  /**
   * Get all tokens with pagination
   */
  async getTokens(limit: number = 50, offset: number = 0): Promise<TokenData[]> {
    try {
      const query = `
        SELECT 
          mint_address,
          creator,
          dev_buy_amount,
          dev_buy_amount_decimal,
          dev_buy_used_token,
          dev_buy_token_amount,
          dev_buy_token_amount_decimal,
          created_at,
          updated_at
        FROM tokens
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `;

      const result = await this.pool.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch tokens:', error);
      return [];
    }
  }

  /**
   * Add a token to the skip list
   */
  async addSkipToken(skipToken: SkipToken): Promise<void> {
    try {
      const query = `
        INSERT INTO skip_tokens (mint_address, symbol, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (mint_address) DO NOTHING
      `;

      const values = [
        skipToken.mint_address,
        skipToken.symbol || null,
        skipToken.description || null,
      ];

      await this.pool.query(query, values);
      console.log(`💾 Skip token added: ${skipToken.mint_address}`);
    } catch (error: any) {
      console.error(`❌ Failed to add skip token:`, error.message);
      throw error;
    }
  }

  /**
   * Remove a token from the skip list
   */
  async removeSkipToken(mintAddress: string): Promise<void> {
    try {
      const query = `DELETE FROM skip_tokens WHERE mint_address = $1`;
      await this.pool.query(query, [mintAddress]);
      console.log(`🗑️ Skip token removed: ${mintAddress}`);
    } catch (error: any) {
      console.error(`❌ Failed to remove skip token:`, error.message);
      throw error;
    }
  }

  /**
   * Get all skip tokens
   */
  async getSkipTokens(): Promise<SkipToken[]> {
    try {
      const query = `
        SELECT id, mint_address, symbol, description, created_at
        FROM skip_tokens
        ORDER BY created_at DESC
      `;

      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch skip tokens:', error);
      return [];
    }
  }

  /**
   * Check if a token is in the skip list
   */
  async isSkipToken(mintAddress: string): Promise<boolean> {
    try {
      const query = `SELECT 1 FROM skip_tokens WHERE mint_address = $1`;
      const result = await this.pool.query(query, [mintAddress]);
      return result.rows.length > 0;
    } catch (error) {
      console.error('Failed to check skip token:', error);
      return false;
    }
  }

  /**
   * Initialize default skip tokens (SOL, USDC, etc.)
   */
  async initializeDefaultSkipTokens(): Promise<void> {
    const defaultSkipTokens = [
      {
        mint_address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        description: 'Wrapped SOL'
      },
      {
        mint_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        description: 'USD Coin'
      },
      {
        mint_address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        symbol: 'USDT',
        description: 'Tether USD'
      }
    ];

    for (const token of defaultSkipTokens) {
      try {
        await this.addSkipToken(token);
      } catch (error) {
        // Ignore errors (likely duplicates)
      }
    }
  }

  /**
   * Fetch token market data from Solscan API
   * Returns: supply, price, decimals, and market_cap (if available)
   * Returns { isEmpty: true } if token is not indexed yet (empty data object)
   */
  async fetchMcapFromSolscan(tokenAddress: string): Promise<{
    supply: string | null;
    price: number | null;
    decimals: number | null;
    market_cap: number | null;
    isEmpty?: boolean;
  } | null> {
    try {
      const solscanApiKey = process.env.SOLSCAN_API_KEY;

      if (!solscanApiKey) {
        console.warn('⚠️ SOLSCAN_API_KEY not set, skipping mcap fetch');
        return null;
      }

      const requestOptions: RequestInit = {
        method: 'GET',
        headers: {
          'token': solscanApiKey
        }
      };

      const response = await fetch(
        `https://pro-api.solscan.io/v2.0/token/meta?address=${tokenAddress}`,
        requestOptions
      );

      if (!response.ok) {
        console.warn(`⚠️ Failed to fetch token data from Solscan: ${response.statusText}`);
        return null;
      }

      const data = await response.json();

      if (!data.success || !data.data) {
        console.warn(`⚠️ Invalid response from Solscan API`);
        return null;
      }

      // Check if data.data is an empty object (token not indexed yet)
      const dataKeys = Object.keys(data.data || {});
      if (dataKeys.length === 0) {
        // Return a special indicator for empty data (needs retry)
        return {
          isEmpty: true,
          supply: null,
          price: null,
          decimals: null,
          market_cap: null
        };
      }

      // Extract supply, price, decimals, and market_cap
      const tokenData = data.data;

      return {
        supply: tokenData.supply || null,
        price: tokenData.price !== null && tokenData.price !== undefined ? parseFloat(tokenData.price.toString()) : null,
        decimals: tokenData.decimals !== null && tokenData.decimals !== undefined ? parseInt(tokenData.decimals.toString()) : null,
        market_cap: tokenData.market_cap !== null && tokenData.market_cap !== undefined ? parseFloat(tokenData.market_cap.toString()) : null,
      };
    } catch (error: any) {
      console.warn(`⚠️ Error fetching token data from Solscan:`, error.message);
      return null;
    }
  }

  /**
   * Save or update wallet-token pair with buy/sell tracking
   */
  async saveWalletTokenPair(
    walletAddress: string,
    tokenAddress: string,
    transactionType: 'BUY' | 'SELL',
    amount: string,
    marketData: {
      supply: string | null;
      price: number | null;
      decimals: number | null;
      market_cap: number | null;
    } | null = null,
    openPositionCount?: number | null
  ): Promise<void> {
    // Use setImmediate to ensure this is truly async and non-blocking
    setImmediate(async () => {
      try {
        if (transactionType === 'BUY') {
          // Insert or update first buy info (only if first_buy_timestamp is NULL)
          // Also record open_position_count for this buy event
          const query = `
            INSERT INTO wallets (
              wallet_address,
              token_address,
              first_buy_timestamp,
              first_buy_amount,
              first_buy_mcap,
              first_buy_supply,
              first_buy_price,
              open_position_count
            ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7)
            ON CONFLICT (wallet_address, token_address) 
            DO UPDATE SET
              first_buy_timestamp = COALESCE(wallets.first_buy_timestamp, CURRENT_TIMESTAMP),
              first_buy_amount = COALESCE(wallets.first_buy_amount, $3),
              first_buy_mcap = COALESCE(wallets.first_buy_mcap, $4),
              first_buy_supply = COALESCE(wallets.first_buy_supply, $5),
              first_buy_price = COALESCE(wallets.first_buy_price, $6),
              open_position_count = $7
          `;
          await this.pool.query(query, [
            walletAddress,
            tokenAddress,
            amount,
            marketData?.market_cap || null,
            marketData?.supply || null,
            marketData?.price || null,
            openPositionCount !== undefined ? openPositionCount : null
          ]);
          const mcapStr = marketData?.market_cap ? marketData.market_cap.toString() : (marketData?.supply ? `${marketData.supply} (MCap N/A)` : 'N/A');
          console.log(`💾 Wallet BUY tracked: ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}... (Amount: ${amount}, MCap: ${mcapStr})`);
        } else if (transactionType === 'SELL') {
          // Insert or update first sell info (only if first_sell_timestamp is NULL)
          const query = `
            INSERT INTO wallets (
              wallet_address,
              token_address,
              first_sell_timestamp,
              first_sell_amount,
              first_sell_mcap,
              first_sell_supply,
              first_sell_price
            ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6)
            ON CONFLICT (wallet_address, token_address) 
            DO UPDATE SET
              first_sell_timestamp = COALESCE(wallets.first_sell_timestamp, CURRENT_TIMESTAMP),
              first_sell_amount = COALESCE(wallets.first_sell_amount, $3),
              first_sell_mcap = COALESCE(wallets.first_sell_mcap, $4),
              first_sell_supply = COALESCE(wallets.first_sell_supply, $5),
              first_sell_price = COALESCE(wallets.first_sell_price, $6)
          `;
          await this.pool.query(query, [
            walletAddress,
            tokenAddress,
            amount,
            marketData?.market_cap || null,
            marketData?.supply || null,
            marketData?.price || null
          ]);
          const mcapStr = marketData?.market_cap ? marketData.market_cap.toString() : (marketData?.supply ? `${marketData.supply} (MCap N/A)` : 'N/A');
          console.log(`💾 Wallet SELL tracked: ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}... (Amount: ${amount}, MCap: ${mcapStr})`);
        }
      } catch (error: any) {
        console.error(`❌ Failed to save wallet-token pair:`, error.message);
      }
    });
  }

  /**
   * Update market data for an existing wallet-token pair
   * Used for retrying market data fetch when token wasn't indexed yet
   */
  async updateWalletTokenMarketData(
    walletAddress: string,
    tokenAddress: string,
    transactionType: 'BUY' | 'SELL',
    marketData: {
      supply: string | null;
      price: number | null;
      decimals: number | null;
      market_cap: number | null;
    } | null
  ): Promise<void> {
    if (!marketData) {
      return;
    }

    try {
      if (transactionType === 'BUY') {
        const query = `
          UPDATE wallets
          SET 
            first_buy_mcap = COALESCE(wallets.first_buy_mcap, $1),
            first_buy_supply = COALESCE(wallets.first_buy_supply, $2),
            first_buy_price = COALESCE(wallets.first_buy_price, $3)
          WHERE wallet_address = $4 AND token_address = $5
        `;
        await this.pool.query(query, [
          marketData.market_cap || null,
          marketData.supply || null,
          marketData.price || null,
          walletAddress,
          tokenAddress
        ]);
        console.log(`✅ Updated BUY market data for ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}...`);
      } else if (transactionType === 'SELL') {
        const query = `
          UPDATE wallets
          SET 
            first_sell_mcap = COALESCE(wallets.first_sell_mcap, $1),
            first_sell_supply = COALESCE(wallets.first_sell_supply, $2),
            first_sell_price = COALESCE(wallets.first_sell_price, $3)
          WHERE wallet_address = $4 AND token_address = $5
        `;
        await this.pool.query(query, [
          marketData.market_cap || null,
          marketData.supply || null,
          marketData.price || null,
          walletAddress,
          tokenAddress
        ]);
        console.log(`✅ Updated SELL market data for ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}...`);
      }
    } catch (error: any) {
      console.error(`❌ Failed to update market data:`, error.message);
    }
  }

  /**
   * Get wallet-token pairs by wallet address with pagination
   */
  async getWalletTokens(walletAddress: string, limit?: number, offset?: number): Promise<{ data: any[], total: number }> {
    try {
      // Get total count
      const countQuery = `
        SELECT COUNT(*) as count
        FROM wallets
        WHERE wallet_address = $1
      `;
      const countResult = await this.pool.query(countQuery, [walletAddress]);
      const total = parseInt(countResult.rows[0].count);

      // Get paginated data
      let query = `
        SELECT 
          wallet_address,
          token_address,
          first_buy_timestamp,
          first_buy_amount,
          first_buy_mcap,
          first_buy_supply,
          first_buy_price,
          first_sell_timestamp,
          first_sell_amount,
          first_sell_mcap,
          first_sell_supply,
          first_sell_price,
          peak_buy_to_sell_price_sol,
          peak_buy_to_sell_price_usd,
          peak_buy_to_sell_mcap,
          peak_sell_to_end_price_sol,
          peak_sell_to_end_price_usd,
          peak_sell_to_end_mcap,
          open_position_count,
          buys_before_first_sell,
          buys_after_first_sell,
          created_at
        FROM wallets
        WHERE wallet_address = $1
        ORDER BY created_at DESC
      `;

      const params: any[] = [walletAddress];

      if (limit !== undefined && offset !== undefined) {
        query += ` LIMIT $2 OFFSET $3`;
        params.push(limit, offset);
      }

      const result = await this.pool.query(query, params);
      return { data: result.rows, total };
    } catch (error) {
      console.error('Failed to fetch wallet tokens:', error);
      return { data: [], total: 0 };
    }
  }

  /**
   * Get total SOL amount from sell events for a wallet-token pair
   */
  async getTotalSellsForWalletToken(walletAddress: string, tokenAddress: string): Promise<number> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const SOL_DECIMALS = 9; // SOL has 9 decimals

      // Query for sell transactions: wallet sells token (mint_from) and receives SOL (mint_to)
      // Use UPPER() for case-insensitive comparison as type might be stored as 'Sell', 'SELL', or 'sell'
      // Cast NUMERIC to ensure proper aggregation
      const query = `
        SELECT COALESCE(SUM(out_amount::NUMERIC), 0)::TEXT as total_amount
        FROM transactions
        WHERE fee_payer = $1
          AND UPPER(TRIM(type)) = 'SELL'
          AND mint_from = $2
          AND mint_to = $3
      `;

      const result = await this.pool.query(query, [walletAddress, tokenAddress, SOL_MINT]);
      const totalAmountRaw = result.rows[0]?.total_amount || '0';

      // Convert from raw amount (with decimals) to SOL
      const totalAmountSOL = parseFloat(totalAmountRaw) / Math.pow(10, SOL_DECIMALS);

      return totalAmountSOL;
    } catch (error) {
      console.error(`Failed to get total sells amount for ${walletAddress} - ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Get total SOL amount spent in buy transactions for a wallet-token pair
   */
  async getTotalBuyAmountForWalletToken(walletAddress: string, tokenAddress: string): Promise<number> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const SOL_DECIMALS = 9; // SOL has 9 decimals

      // Query for buy transactions: wallet buys token (mint_to) and spends SOL (mint_from)
      // Use UPPER() for case-insensitive comparison as type might be stored as 'Buy', 'BUY', or 'buy'
      // Cast NUMERIC to ensure proper aggregation
      const query = `
        SELECT COALESCE(SUM(in_amount::NUMERIC), 0)::TEXT as total_amount
        FROM transactions
        WHERE fee_payer = $1
          AND UPPER(TRIM(type)) = 'BUY'
          AND mint_from = $2
          AND mint_to = $3
      `;

      const result = await this.pool.query(query, [walletAddress, SOL_MINT, tokenAddress]);
      const totalAmountRaw = result.rows[0]?.total_amount || '0';

      // Convert from raw amount (with decimals) to SOL
      const totalAmountSOL = parseFloat(totalAmountRaw) / Math.pow(10, SOL_DECIMALS);

      return totalAmountSOL;
    } catch (error) {
      console.error(`Failed to get total buy amount for ${walletAddress} - ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Get total token amount received in buy transactions for a wallet-token pair
   */
  async getTotalBuyTokensForWalletToken(walletAddress: string, tokenAddress: string, tokenDecimals: number | null = null): Promise<number> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';

      // Query for buy transactions: wallet buys token (mint_to) and receives tokens (out_amount)
      // Use UPPER() for case-insensitive comparison as type might be stored as 'Buy', 'BUY', or 'buy'
      // Cast NUMERIC to ensure proper aggregation
      const query = `
        SELECT COALESCE(SUM(out_amount::NUMERIC), 0)::TEXT as total_amount
        FROM transactions
        WHERE fee_payer = $1
          AND UPPER(TRIM(type)) = 'BUY'
          AND mint_from = $2
          AND mint_to = $3
      `;

      const result = await this.pool.query(query, [walletAddress, SOL_MINT, tokenAddress]);
      const totalAmountRaw = result.rows[0]?.total_amount || '0';

      // Get token decimals if not provided or invalid
      // Priority: dev_buy_token_amount_decimal (from tokens table) > default 9
      let decimals = tokenDecimals;
      if (decimals === null || decimals === undefined || isNaN(decimals)) {
        // Try to get dev_buy_token_amount_decimal from tokens table (most accurate for token decimals)
        const tokenQuery = `
          SELECT dev_buy_token_amount_decimal FROM tokens WHERE mint_address = $1
        `;
        const tokenResult = await this.pool.query(tokenQuery, [tokenAddress]);
        const devBuyTokenDecimals = tokenResult.rows[0]?.dev_buy_token_amount_decimal;

        if (devBuyTokenDecimals !== null && devBuyTokenDecimals !== undefined && !isNaN(devBuyTokenDecimals)) {
          decimals = devBuyTokenDecimals;
        } else {
          // Default to 9 if not found
          decimals = 9;
        }
      }

      // Ensure decimals is a valid number
      if (isNaN(decimals) || decimals < 0) {
        decimals = 9; // Fallback to 9
      }

      // Convert from raw amount (with decimals) to token amount
      const totalAmountNum = parseFloat(totalAmountRaw);
      if (isNaN(totalAmountNum)) {
        return 0;
      }

      // If totalAmountNum is 0, return 0 (no buy transactions or sum is 0)
      if (totalAmountNum === 0) {
        return 0;
      }

      const totalTokens = totalAmountNum / Math.pow(10, decimals);

      return totalTokens;
    } catch (error) {
      console.error(`Failed to get total buy tokens for ${walletAddress} - ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Get buy count for a specific wallet-token pair
   */
  async getBuyCountForToken(walletAddress: string, tokenAddress: string): Promise<number> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const buyQuery = `
        SELECT COUNT(*) as count
        FROM transactions
        WHERE fee_payer = $1
          AND UPPER(TRIM(type)) = 'BUY'
          AND mint_from = $2
          AND mint_to = $3
      `;
      const buyResult = await this.pool.query(buyQuery, [walletAddress, SOL_MINT, tokenAddress]);
      return parseInt(buyResult.rows[0]?.count || '0', 10);
    } catch (error) {
      console.error(`Failed to get buy count for ${walletAddress} - ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Get sell count for a specific wallet-token pair
   */
  async getSellCountForToken(walletAddress: string, tokenAddress: string): Promise<number> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const sellQuery = `
        SELECT COUNT(*) as count
        FROM transactions
        WHERE fee_payer = $1
          AND UPPER(TRIM(type)) = 'SELL'
          AND mint_from = $2
          AND mint_to = $3
      `;
      const sellResult = await this.pool.query(sellQuery, [walletAddress, tokenAddress, SOL_MINT]);
      return parseInt(sellResult.rows[0]?.count || '0', 10);
    } catch (error) {
      console.error(`Failed to get sell count for ${walletAddress} - ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Get wallets by token address
   */
  async getTokenWallets(tokenAddress: string, limit: number = 50): Promise<any[]> {
    try {
      const query = `
        SELECT 
          wallet_address,
          token_address,
          first_buy_timestamp,
          first_buy_amount,
          first_buy_mcap,
          first_buy_supply,
          first_buy_price,
          first_sell_timestamp,
          first_sell_amount,
          first_sell_mcap,
          first_sell_supply,
          first_sell_price,
          created_at
        FROM wallets
        WHERE token_address = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const result = await this.pool.query(query, [tokenAddress, limit]);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch token wallets:', error);
      return [];
    }
  }

  /**
   * Get all unique wallet addresses from transactions table
   */
  async getAllWalletsFromTransactions(): Promise<string[]> {
    try {
      const query = `
        SELECT DISTINCT fee_payer as wallet_address
        FROM transactions
        ORDER BY fee_payer ASC
      `;

      const result = await this.pool.query(query);
      return result.rows.map((row) => row.wallet_address);
    } catch (error) {
      console.error('Failed to fetch wallets from transactions:', error);
      return [];
    }
  }

  /**
   * Get all wallet-token pairs with pagination
   */
  async getWalletTokenPairs(limit: number = 50, offset: number = 0): Promise<any[]> {
    try {
      const query = `
        SELECT 
          wallet_address,
          token_address,
          first_buy_timestamp,
          first_buy_amount,
          first_buy_mcap,
          first_buy_supply,
          first_buy_price,
          first_sell_timestamp,
          first_sell_amount,
          first_sell_mcap,
          first_sell_supply,
          first_sell_price,
          created_at
        FROM wallets
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `;

      const result = await this.pool.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch wallet-token pairs:', error);
      return [];
    }
  }


  /**
   * Check if a column exists in a table
   */
  async columnExists(tableName: string, columnName: string): Promise<boolean> {
    try {
      const query = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = $2
      `;
      const result = await this.pool.query(query, [tableName, columnName]);
      return result.rows.length > 0;
    } catch (error) {
      console.error(`Failed to check column existence: ${tableName}.${columnName}`, error);
      return false;
    }
  }

  /**
   * Check if a table exists
   */
  async tableExists(tableName: string): Promise<boolean> {
    try {
      const query = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = $1
      `;
      const result = await this.pool.query(query, [tableName]);
      return result.rows.length > 0;
    } catch (error) {
      console.error(`Failed to check table existence: ${tableName}`, error);
      return false;
    }
  }

  /**
   * Get the current password hash from credentials table
   */
  async getPasswordHash(): Promise<string | null> {
    try {
      const query = `
        SELECT password_hash 
        FROM credentials 
        ORDER BY id DESC 
        LIMIT 1
      `;
      const result = await this.pool.query(query);
      return result.rows.length > 0 ? result.rows[0].password_hash : null;
    } catch (error) {
      console.error('Failed to get password hash:', error);
      return null;
    }
  }

  /**
   * Update password hash in credentials table
   */
  async updatePasswordHash(passwordHash: string): Promise<void> {
    try {
      // Check if any credentials exist
      const checkQuery = `SELECT COUNT(*) as count FROM credentials`;
      const checkResult = await this.pool.query(checkQuery);
      const count = parseInt(checkResult.rows[0].count);

      if (count === 0) {
        // Insert first password
        const insertQuery = `
          INSERT INTO credentials (password_hash) 
          VALUES ($1)
        `;
        await this.pool.query(insertQuery, [passwordHash]);
      } else {
        // Update existing password
        const updateQuery = `
          UPDATE credentials 
          SET password_hash = $1, updated_at = CURRENT_TIMESTAMP 
          WHERE id = (SELECT id FROM credentials ORDER BY id DESC LIMIT 1)
        `;
        await this.pool.query(updateQuery, [passwordHash]);
      }
    } catch (error) {
      console.error('Failed to update password hash:', error);
      throw error;
    }
  }

  /**
   * Save dashboard filter preset
   */
  async saveDashboardFilterPreset(
    name: string,
    filters: {
      filters?: Array<{
        key: string;
        label: string;
        type: string;
        min: number | null;
        max: number | null;
        minEnabled?: boolean;
        maxEnabled?: boolean;
      }>;
      devBuySizeMin?: number | null;
      devBuySizeMax?: number | null;
      buySizeMin?: number | null;
      buySizeMax?: number | null;
      pnlMin?: number | null;
      pnlMax?: number | null;
      columnVisibility?: { [key: string]: boolean };
      sellColumnVisibility?: { [key: string]: boolean };
    }
  ): Promise<void> {
    try {
      // Build the complete preset object to store
      let presetData: any = {};

      // Extract new format filters array if present
      if (filters.filters && Array.isArray(filters.filters)) {
        // New format: use filters array directly
        presetData.filters = filters.filters;
      } else {
        // Old format: convert to new format for backward compatibility
        const convertedFilters: any[] = [];

        if (filters.devBuySizeMin !== null && filters.devBuySizeMin !== undefined ||
          filters.devBuySizeMax !== null && filters.devBuySizeMax !== undefined) {
          convertedFilters.push({
            key: 'devBuyAmountSOL',
            label: 'Dev Buy Amount in SOL',
            type: 'sol',
            min: filters.devBuySizeMin ?? null,
            max: filters.devBuySizeMax ?? null,
            minEnabled: true,
            maxEnabled: true
          });
        }

        if (filters.buySizeMin !== null && filters.buySizeMin !== undefined ||
          filters.buySizeMax !== null && filters.buySizeMax !== undefined) {
          convertedFilters.push({
            key: 'walletBuyAmountSOL',
            label: 'Wallet Buy Amount in SOL',
            type: 'sol',
            min: filters.buySizeMin ?? null,
            max: filters.buySizeMax ?? null,
            minEnabled: true,
            maxEnabled: true
          });
        }

        if (filters.pnlMin !== null && filters.pnlMin !== undefined ||
          filters.pnlMax !== null && filters.pnlMax !== undefined) {
          convertedFilters.push({
            key: 'pnlPercent',
            label: '% PNL per token',
            type: 'percent',
            min: filters.pnlMin ?? null,
            max: filters.pnlMax ?? null,
            minEnabled: true,
            maxEnabled: true
          });
        }

        presetData.filters = convertedFilters;
      }

      // Include column visibility if provided
      if (filters.columnVisibility) {
        presetData.columnVisibility = filters.columnVisibility;
      }
      if (filters.sellColumnVisibility) {
        presetData.sellColumnVisibility = filters.sellColumnVisibility;
      }

      // Also include old format for backward compatibility
      if (filters.devBuySizeMin !== null && filters.devBuySizeMin !== undefined) {
        presetData.devBuySizeMin = filters.devBuySizeMin;
        presetData.devBuySizeMax = filters.devBuySizeMax;
      }
      if (filters.buySizeMin !== null && filters.buySizeMin !== undefined) {
        presetData.buySizeMin = filters.buySizeMin;
        presetData.buySizeMax = filters.buySizeMax;
      }
      if (filters.pnlMin !== null && filters.pnlMin !== undefined) {
        presetData.pnlMin = filters.pnlMin;
        presetData.pnlMax = filters.pnlMax;
      }

      const filtersJson = JSON.stringify(presetData);

      const query = `
        INSERT INTO dashboard_filter_presets (
          name,
          filters_json
        ) VALUES ($1, $2)
        ON CONFLICT (name) DO UPDATE SET
          filters_json = EXCLUDED.filters_json,
          updated_at = CURRENT_TIMESTAMP
      `;

      await this.pool.query(query, [name, filtersJson]);

      console.log(`💾 Dashboard filter preset saved: ${name}`);
    } catch (error: any) {
      console.error(`❌ Failed to save filter preset:`, error.message);
      throw error;
    }
  }

  /**
   * Get all dashboard filter presets
   */
  async getDashboardFilterPresets(): Promise<any[]> {
    try {
      const query = `
        SELECT 
          id,
          name,
          filters_json as "filtersJson",
          created_at,
          updated_at
        FROM dashboard_filter_presets
        ORDER BY updated_at DESC
      `;

      const result = await this.pool.query(query);
      // Parse JSON - now contains full preset data
      return result.rows.map(row => {
        if (row.filtersJson) {
          try {
            const parsed = typeof row.filtersJson === 'string'
              ? JSON.parse(row.filtersJson)
              : row.filtersJson;

            // If it's an array (old format), wrap it
            if (Array.isArray(parsed)) {
              row.filters = parsed;
            } else {
              // New format: full preset object
              row.filters = parsed.filters || [];
              row.columnVisibility = parsed.columnVisibility;
              row.sellColumnVisibility = parsed.sellColumnVisibility;
              // Include old format properties for backward compatibility
              if (parsed.devBuySizeMin !== undefined) row.devBuySizeMin = parsed.devBuySizeMin;
              if (parsed.devBuySizeMax !== undefined) row.devBuySizeMax = parsed.devBuySizeMax;
              if (parsed.buySizeMin !== undefined) row.buySizeMin = parsed.buySizeMin;
              if (parsed.buySizeMax !== undefined) row.buySizeMax = parsed.buySizeMax;
              if (parsed.pnlMin !== undefined) row.pnlMin = parsed.pnlMin;
              if (parsed.pnlMax !== undefined) row.pnlMax = parsed.pnlMax;
            }
          } catch (e) {
            console.error('Failed to parse filters_json:', e);
            row.filters = [];
          }
        } else {
          row.filters = [];
        }
        return row;
      });
    } catch (error) {
      console.error('Failed to fetch filter presets:', error);
      return [];
    }
  }

  /**
   * Get dashboard filter preset by name
   */
  async getDashboardFilterPreset(name: string): Promise<any | null> {
    try {
      const query = `
        SELECT 
          id,
          name,
          filters_json as "filtersJson",
          created_at,
          updated_at
        FROM dashboard_filter_presets
        WHERE name = $1
        LIMIT 1
      `;

      const result = await this.pool.query(query, [name]);
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      // Parse JSON - now contains full preset data
      if (row.filtersJson) {
        try {
          const parsed = typeof row.filtersJson === 'string'
            ? JSON.parse(row.filtersJson)
            : row.filtersJson;

          // If it's an array (old format), wrap it
          if (Array.isArray(parsed)) {
            row.filters = parsed;
          } else {
            // New format: full preset object
            row.filters = parsed.filters || [];
            row.columnVisibility = parsed.columnVisibility;
            row.sellColumnVisibility = parsed.sellColumnVisibility;
            // Include old format properties for backward compatibility
            if (parsed.devBuySizeMin !== undefined) row.devBuySizeMin = parsed.devBuySizeMin;
            if (parsed.devBuySizeMax !== undefined) row.devBuySizeMax = parsed.devBuySizeMax;
            if (parsed.buySizeMin !== undefined) row.buySizeMin = parsed.buySizeMin;
            if (parsed.buySizeMax !== undefined) row.buySizeMax = parsed.buySizeMax;
            if (parsed.pnlMin !== undefined) row.pnlMin = parsed.pnlMin;
            if (parsed.pnlMax !== undefined) row.pnlMax = parsed.pnlMax;
          }
        } catch (e) {
          console.error('Failed to parse filters_json:', e);
          row.filters = [];
        }
      } else {
        row.filters = [];
      }

      return row;
    } catch (error) {
      console.error('Failed to fetch filter preset:', error);
      return null;
    }
  }

  /**
   * Delete dashboard filter preset
   */
  async deleteDashboardFilterPreset(name: string): Promise<void> {
    try {
      const query = `DELETE FROM dashboard_filter_presets WHERE name = $1`;
      await this.pool.query(query, [name]);
      console.log(`🗑️ Filter preset deleted: ${name}`);
    } catch (error: any) {
      console.error(`❌ Failed to delete filter preset:`, error.message);
      throw error;
    }
  }

  /**
   * Update peak prices for a wallet-token pair
   */
  async updateWalletPeakPrices(
    walletAddress: string,
    tokenAddress: string,
    peakBuyToSellPriceSol: number,
    peakBuyToSellPriceUsd: number,
    peakBuyToSellMcap: number,
    peakSellToEndPriceSol: number,
    peakSellToEndPriceUsd: number,
    peakSellToEndMcap: number,
    buysBeforeFirstSell: number = 0,
    buysAfterFirstSell: number = 0
  ): Promise<void> {
    try {
      const query = `
        UPDATE wallets
        SET peak_buy_to_sell_price_sol = $3,
            peak_buy_to_sell_price_usd = $4,
            peak_buy_to_sell_mcap = $5,
            peak_sell_to_end_price_sol = $6,
            peak_sell_to_end_price_usd = $7,
            peak_sell_to_end_mcap = $8,
            buys_before_first_sell = $9,
            buys_after_first_sell = $10
        WHERE wallet_address = $1 AND token_address = $2
      `;
      await this.pool.query(query, [
        walletAddress,
        tokenAddress,
        peakBuyToSellPriceSol || null,
        peakBuyToSellPriceUsd || null,
        peakBuyToSellMcap || null,
        peakSellToEndPriceSol || null,
        peakSellToEndPriceUsd || null,
        peakSellToEndMcap || null,
        buysBeforeFirstSell || 0,
        buysAfterFirstSell || 0
      ]);
      console.log(`💾 Peak prices updated for wallet ${walletAddress.substring(0, 8)}... - token ${tokenAddress.substring(0, 8)}...`);
    } catch (error: any) {
      console.error(`❌ Failed to update peak prices:`, error.message);
    }
  }

  /**
   * Save timeseries data for pool monitoring (marketcap, tokenPriceSOL, tokenPriceUSD)
   * Appends data point to JSONB array in wallets table
   */
  async savePoolPriceTimeseries(
    walletAddress: string,
    tokenAddress: string,
    marketcap: number,
    tokenPriceSol: number,
    tokenPriceUsd: number,
    poolAddress?: string,
    sessionKey?: string,
    timestamp?: Date
  ): Promise<void> {
    // Use setImmediate to ensure this is truly async and non-blocking
    setImmediate(async () => {
      try {
        const dataPoint = {
          timestamp: (timestamp || new Date()).toISOString(),
          marketcap: marketcap || null,
          tokenPriceSol: tokenPriceSol || null,
          tokenPriceUsd: tokenPriceUsd || null,
          poolAddress: poolAddress || null,
          sessionKey: sessionKey || null
        };

        const query = `
          UPDATE wallets
          SET price_timeseries = COALESCE(price_timeseries, '[]'::jsonb) || $1::jsonb
          WHERE wallet_address = $2 AND token_address = $3
        `;

        await this.pool.query(query, [
          JSON.stringify([dataPoint]),
          walletAddress,
          tokenAddress
        ]);
      } catch (error: any) {
        console.error(`❌ Failed to save pool price timeseries data:`, error.message);
      }
    });
  }

  /**
   * Save batch of timeseries data points for pool monitoring
   * Appends all data points to JSONB array in wallets table at once
   */
  async savePoolPriceTimeseriesBatch(
    walletAddress: string,
    tokenAddress: string,
    timeseriesData: Array<{
      timestamp: string;
      marketcap: number | null;
      tokenPriceSol: number | null;
      tokenPriceUsd: number | null;
      poolAddress: string | null;
      sessionKey: string | null;
      signature?: string | null;
    }>
  ): Promise<void> {
    if (!timeseriesData || timeseriesData.length === 0) {
      return;
    }

    try {
      const query = `
        UPDATE wallets
        SET price_timeseries = COALESCE(price_timeseries, '[]'::jsonb) || $1::jsonb
        WHERE wallet_address = $2 AND token_address = $3
      `;

      await this.pool.query(query, [
        JSON.stringify(timeseriesData),
        walletAddress,
        tokenAddress
      ]);
    } catch (error: any) {
      console.error(`❌ Failed to save pool price timeseries batch data:`, error.message);
      throw error;
    }
  }

  /**
   * Check if this is the first buy for a wallet-token pair
   */
  async isFirstBuy(walletAddress: string, tokenAddress: string): Promise<boolean> {
    try {
      const query = `
        SELECT first_buy_timestamp
        FROM wallets
        WHERE wallet_address = $1 AND token_address = $2
      `;
      const result = await this.pool.query(query, [walletAddress, tokenAddress]);

      // If no record exists or first_buy_timestamp is null, it's the first buy
      return result.rows.length === 0 || result.rows[0].first_buy_timestamp === null;
    } catch (error: any) {
      console.error(`❌ Failed to check first buy:`, error.message);
      return false;
    }
  }

  /**
   * Get market cap from timeseries data at a specific timestamp
   * Returns the market cap from the previous timestamp (the one before the target)
   * If target is between A and B, it uses A (previous timestamp, not after)
   */
  async getMarketCapAtTimestamp(
    walletAddress: string,
    tokenAddress: string,
    targetTimestamp: number
  ): Promise<number | null> {
    try {
      const query = `
        SELECT price_timeseries
        FROM wallets
        WHERE wallet_address = $1 AND token_address = $2
      `;
      const result = await this.pool.query(query, [walletAddress, tokenAddress]);
      
      if (result.rows.length === 0 || !result.rows[0].price_timeseries) {
        return null;
      }
      
      const timeseries = result.rows[0].price_timeseries;
      if (!Array.isArray(timeseries) || timeseries.length === 0) {
        return null;
      }
      
      // Convert target timestamp to milliseconds
      const targetTime = targetTimestamp;
      
      // Find the previous data point (the one with timestamp <= target)
      // If target is between A and B, use A (previous timestamp)
      let previousPoint: any = null;
      
      for (const point of timeseries) {
        if (!point.timestamp || point.marketcap === null || point.marketcap === undefined) {
          continue;
        }
        
        const pointTime = new Date(point.timestamp).getTime();
        
        // If this point is before or equal to target, it's a candidate
        if (pointTime <= targetTime) {
          // If we don't have a previous point yet, or this one is closer to target (but still <= target)
          if (!previousPoint || pointTime > new Date(previousPoint.timestamp).getTime()) {
            previousPoint = point;
          }
        }
      }
      
      // Return market cap from previous point
      if (previousPoint) {
        return parseFloat(previousPoint.marketcap);
      }
      
      return null;
    } catch (error: any) {
      console.error(`❌ Failed to get market cap at timestamp:`, error.message);
      return null;
    }
  }

  /**
   * Delete all transactions and wallet entries for a specific wallet address
   * This removes the wallet from transactions table and wallets table (not tokens table)
   */
  async deleteWalletAndTransactions(walletAddress: string): Promise<{ transactionsDeleted: number; walletsDeleted: number }> {
    try {
      // Delete transactions for this wallet
      const deleteTransactionsQuery = `
        DELETE FROM transactions
        WHERE fee_payer = $1
      `;
      const transactionsResult = await this.pool.query(deleteTransactionsQuery, [walletAddress]);
      const transactionsDeleted = transactionsResult.rowCount || 0;

      // Delete wallet entries for this wallet
      const deleteWalletsQuery = `
        DELETE FROM wallets
        WHERE wallet_address = $1
      `;
      const walletsResult = await this.pool.query(deleteWalletsQuery, [walletAddress]);
      const walletsDeleted = walletsResult.rowCount || 0;

      console.log(`🗑️ Deleted wallet ${walletAddress}: ${transactionsDeleted} transactions, ${walletsDeleted} wallet entries`);

      return { transactionsDeleted, walletsDeleted };
    } catch (error: any) {
      console.error(`❌ Failed to delete wallet ${walletAddress}:`, error.message);
      throw error;
    }
  }
}

// Export a singleton instance
export const dbService = new DatabaseService();

