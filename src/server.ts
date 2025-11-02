require("dotenv").config();
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { dbService } from "./database";
import { tracker } from "./tracker";
import { tokenService } from "./services/tokenService";
import { walletTrackingService } from "./services/walletTrackingService";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "../public")));

// Initialize database and tracker
async function initializeApp() {
  try {
    await dbService.initialize();
    await dbService.initializeDefaultSkipTokens();
    tracker.initialize();
    console.log("✅ Application initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize application:", error);
    throw error;
  }
}

// API Routes

/**
 * GET /api/status - Get tracker status
 */
app.get("/api/status", (req, res) => {
  res.json({
    isRunning: tracker.isTrackerRunning(),
    addresses: tracker.getAddresses(),
  });
});

/**
 * POST /api/addresses - Set addresses to track
 */
app.post("/api/addresses", (req, res) => {
  try {
    const { addresses } = req.body;
    
    console.log('\n' + '📥 '.repeat(30));
    console.log('RECEIVED ADDRESSES FROM WEB INTERFACE:');
    console.log('📥 '.repeat(30));
    
    if (!Array.isArray(addresses)) {
      console.log('❌ Error: Addresses must be an array');
      return res.status(400).json({ error: "Addresses must be an array" });
    }

    // Filter out empty addresses
    const validAddresses = addresses.filter(addr => addr && addr.trim().length > 0);
    
    if (validAddresses.length === 0) {
      console.log('❌ Error: No valid addresses provided');
      return res.status(400).json({ error: "At least one valid address is required" });
    }

    validAddresses.forEach((addr, index) => {
      console.log(`   Input Field ${index + 1}: ${addr}`);
    });
    console.log('\n➡️  Passing addresses to tracker...');
    
    tracker.setAddresses(validAddresses);
    
    console.log('✅ Addresses successfully configured!\n');
    
    res.json({ 
      success: true, 
      message: "Addresses updated successfully",
      addresses: validAddresses
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/start - Start tracking
 */
app.post("/api/start", async (req, res) => {
  try {
    const result = await tracker.start();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/stop - Stop tracking
 */
app.post("/api/stop", async (req, res) => {
  try {
    const result = await tracker.stop();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/transactions - Get transactions with pagination and date filtering
 */
app.get("/api/transactions", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    
    const [transactions, total] = await Promise.all([
      dbService.getTransactions(limit, offset, fromDate, toDate),
      dbService.getTransactionCount(fromDate, toDate)
    ]);
    
    res.json({
      transactions,
      total,
      limit,
      offset,
      fromDate: fromDate || null,
      toDate: toDate || null
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analyze/:wallet - Analyze wallet information (shows trading history from wallets table)
 */
app.get("/api/analyze/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;
    
    // Get wallet trading history from wallets table
    const walletTrades = await walletTrackingService.getWalletTokens(wallet);
    
    // Get unique token addresses
    const tokenAddresses = walletTrades.map((trade: any) => trade.token_address);
    
    // Fetch token information from database for display
    let tokenInfo: Record<string, any> = {};
    if (tokenAddresses.length > 0) {
      const tokensFromDb = await dbService.getTokensByMints(tokenAddresses);
      // Convert array to object for easier lookup
      tokenInfo = tokensFromDb.reduce((acc, token) => {
        acc[token.mint_address] = token;
        return acc;
      }, {} as Record<string, any>);
    }
    
    // Format trading data for frontend
    const tradingData = walletTrades.map((trade: any) => ({
      token_address: trade.token_address,
      first_buy_timestamp: trade.first_buy_timestamp,
      first_buy_amount: trade.first_buy_amount,
      first_buy_mcap: trade.first_buy_mcap,
      first_buy_supply: trade.first_buy_supply,
      first_buy_price: trade.first_buy_price,
      first_buy_decimals: trade.first_buy_decimals,
      first_sell_timestamp: trade.first_sell_timestamp,
      first_sell_amount: trade.first_sell_amount,
      first_sell_mcap: trade.first_sell_mcap,
      first_sell_supply: trade.first_sell_supply,
      first_sell_price: trade.first_sell_price,
      first_sell_decimals: trade.first_sell_decimals,
      created_at: trade.created_at,
      // Add token metadata from tokens table
      token_name: tokenInfo[trade.token_address]?.token_name || null,
      symbol: tokenInfo[trade.token_address]?.symbol || null,
      image: tokenInfo[trade.token_address]?.image || null,
      creator: tokenInfo[trade.token_address]?.creator || null,
      // Add dev buy information
      dev_buy_amount: tokenInfo[trade.token_address]?.dev_buy_amount || null,
      dev_buy_amount_decimal: tokenInfo[trade.token_address]?.dev_buy_amount_decimal || null,
      dev_buy_token_amount: tokenInfo[trade.token_address]?.dev_buy_token_amount || null,
      dev_buy_token_amount_decimal: tokenInfo[trade.token_address]?.dev_buy_token_amount_decimal || null,
      dev_buy_used_token: tokenInfo[trade.token_address]?.dev_buy_used_token || null,
    }));
    
    res.json({
      wallet: wallet,
      trades: tradingData,
      totalTrades: tradingData.length,
      tokenInfo
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/tokens/fetch-info - Fetch and cache token mint info
 * Request body: { mints: string[] }
 */
app.post("/api/tokens/fetch-info", async (req, res) => {
  try {
    const { mints } = req.body;
    
    if (!Array.isArray(mints) || mints.length === 0) {
      return res.status(400).json({ error: "Mints array is required" });
    }

    console.log(`🔍 Fetching info for ${mints.length} tokens...`);

    // Check which tokens are already cached
    const cachedTokens = await dbService.getTokensByMints(mints);
    const cachedMints = new Set(cachedTokens.map(t => t.mint_address));
    
    // Find tokens that need to be fetched
    const uncachedMints = mints.filter(mint => !cachedMints.has(mint));
    
    console.log(`✅ ${cachedTokens.length} tokens already cached`);
    console.log(`🔄 Fetching ${uncachedMints.length} new tokens sequentially...`);

    // Fetch creator info for uncached tokens sequentially (one at a time)
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < uncachedMints.length; i++) {
      const mint = uncachedMints[i];
      console.log(`  [${i + 1}/${uncachedMints.length}] Fetching ${mint}...`);
      
      try {
        const tokenInfo = await tokenService.getTokenCreatorInfo(mint);
        if (tokenInfo) {
          await dbService.saveToken({
            mint_address: mint,
            creator: tokenInfo.creator,
            dev_buy_amount: tokenInfo.devBuyAmount,
            dev_buy_amount_decimal: tokenInfo.devBuyAmountDecimal,
            dev_buy_used_token: tokenInfo.devBuyUsedToken,
            dev_buy_token_amount: tokenInfo.devBuyTokenAmount,
            dev_buy_token_amount_decimal: tokenInfo.devBuyTokenAmountDecimal,
          });
          successCount++;
          console.log(`  ✅ Success: ${mint}`);
        } else {
          failCount++;
          console.log(`  ❌ No info found: ${mint}`);
        }
      } catch (error) {
        failCount++;
        console.error(`  ❌ Error fetching ${mint}:`, error);
      }
    }

    // Get all token data including newly fetched ones
    const allTokens = await dbService.getTokensByMints(mints);

    res.json({
      success: true,
      message: `Fetched ${successCount} tokens, ${failCount} failed, ${cachedTokens.length} cached`,
      tokens: allTokens,
      stats: {
        total: mints.length,
        cached: cachedTokens.length,
        fetched: successCount,
        failed: failCount,
      }
    });
  } catch (error: any) {
    console.error('Error fetching token info:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/skip-tokens - Get all skip tokens
 */
app.get("/api/skip-tokens", async (req, res) => {
  try {
    const skipTokens = await dbService.getSkipTokens();
    res.json({ 
      success: true,
      skipTokens 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/skip-tokens - Add a token to skip list
 * Request body: { mint_address: string, symbol?: string, description?: string }
 */
app.post("/api/skip-tokens", async (req, res) => {
  try {
    const { mint_address, symbol, description } = req.body;
    
    if (!mint_address || mint_address.trim().length === 0) {
      return res.status(400).json({ error: "mint_address is required" });
    }
    
    await dbService.addSkipToken({
      mint_address: mint_address.trim(),
      symbol: symbol?.trim(),
      description: description?.trim()
    });
    
    // Refresh the token service cache
    await tokenService.refreshSkipTokensCache();
    
    res.json({ 
      success: true,
      message: "Skip token added successfully"
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/skip-tokens/:mintAddress - Remove a token from skip list
 */
app.delete("/api/skip-tokens/:mintAddress", async (req, res) => {
  try {
    const { mintAddress } = req.params;
    
    await dbService.removeSkipToken(mintAddress);
    
    // Refresh the token service cache
    await tokenService.refreshSkipTokensCache();
    
    res.json({ 
      success: true,
      message: "Skip token removed successfully"
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET / - Serve the main HTML page
 */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏸️  Shutting down gracefully...');
  await tracker.stop();
  await dbService.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⏸️  Shutting down gracefully...');
  await tracker.stop();
  await dbService.close();
  process.exit(0);
});

// Start server
async function main() {
  try {
    await initializeApp();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
      console.log(`📊 Open your browser to view the dashboard`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();

