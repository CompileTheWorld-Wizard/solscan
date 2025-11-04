require("dotenv").config();
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import session from "express-session";
import ExcelJS from "exceljs";
import { setupFileLogging } from "./utils/logger";
import { dbService } from "./database";
import { tracker } from "./tracker";
import { tokenService } from "./services/tokenService";
import { walletTrackingService } from "./services/walletTrackingService";

// Extend session type to include authenticated property
declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

// Setup file logging (must be done early, before any console.log calls)
setupFileLogging();

const app = express();
const PORT = process.env.PORT || 3000;

// Session configuration
const HARDCODED_PASSWORD = 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (HTTPS)
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// HTML route handlers (must come BEFORE static middleware)
/**
 * GET /login.html - Serve the login page (public)
 */
app.get("/login.html", (req, res) => {
  // If already authenticated, redirect to main app
  if (isAuthenticated(req)) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, "../public/login.html"));
});

/**
 * GET / - Serve the main HTML page (protected)
 */
app.get("/", (req, res) => {
  // If not authenticated, redirect to login
  if (!isAuthenticated(req)) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Serve static files (CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname, "../public")));

/**
 * Authentication middleware
 */
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.session && req.session.authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

/**
 * Check if user is authenticated (for API routes)
 */
function isAuthenticated(req: express.Request): boolean {
  return req.session && req.session.authenticated === true;
}

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

// Authentication Routes

/**
 * POST /api/login - Login endpoint
 */
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  
  if (password === HARDCODED_PASSWORD) {
    req.session.authenticated = true;
    res.json({ success: true, message: 'Login successful' });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

/**
 * POST /api/logout - Logout endpoint
 */
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Failed to logout' });
    } else {
      res.json({ success: true, message: 'Logout successful' });
    }
  });
});

/**
 * GET /api/auth/status - Check authentication status
 */
app.get("/api/auth/status", (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

// API Routes (protected)

/**
 * GET /api/status - Get tracker status
 */
app.get("/api/status", requireAuth, (req, res) => {
  res.json({
    isRunning: tracker.isTrackerRunning(),
    addresses: tracker.getAddresses(),
  });
});

/**
 * POST /api/addresses - Set addresses to track
 */
app.post("/api/addresses", requireAuth, (req, res) => {
  try {
    const { addresses } = req.body;
        
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
app.post("/api/start", requireAuth, async (req, res) => {
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
app.post("/api/stop", requireAuth, async (req, res) => {
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
app.get("/api/transactions", requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    const wallets = req.query.wallets as string; // Comma-separated wallet addresses
    
    // Parse wallets if provided
    const walletAddresses = wallets ? wallets.split(',').filter(w => w.trim().length > 0) : null;
    
    const [transactions, total] = await Promise.all([
      dbService.getTransactions(limit, offset, fromDate, toDate, walletAddresses),
      dbService.getTransactionCount(fromDate, toDate, walletAddresses)
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
 * GET /api/export-token/:wallet/:token - Get token data and transactions for export (JSON)
 */
app.get("/api/export-token/:wallet/:token", requireAuth, async (req, res) => {
  try {
    const { wallet, token } = req.params;
    
    // Get token information
    const tokens = await dbService.getTokensByMints([token]);
    const tokenInfo = tokens.length > 0 ? tokens[0] : null;
    
    // Get wallet token info
    const walletTrades = await walletTrackingService.getWalletTokens(wallet);
    const walletTokenInfo = walletTrades.find((t: any) => t.token_address === token) || null;
    
    // Get all transactions for this wallet+token pair
    const transactions = await dbService.getTransactionsByWalletToken(wallet, token);
    
    // Count total sells
    const totalSells = transactions.filter(tx => tx.type?.toLowerCase() === 'sell').length;
    
    res.json({
      success: true,
      data: {
        tokenInfo,
        walletTokenInfo,
        transactions,
        totalSells
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/export-token-excel/:wallet/:token - Generate Excel file with styling
 */
app.get("/api/export-token-excel/:wallet/:token", requireAuth, async (req, res) => {
  try {
    const { wallet, token } = req.params;
    
    // Get token information
    const tokens = await dbService.getTokensByMints([token]);
    const tokenInfo = tokens.length > 0 ? tokens[0] : null;
    
    // Get wallet token info
    const walletTrades = await walletTrackingService.getWalletTokens(wallet);
    const walletTokenInfo = walletTrades.find((t: any) => t.token_address === token) || null;
    
    // Get all transactions for this wallet+token pair
    const transactions = await dbService.getTransactionsByWalletToken(wallet, token);
    
    // Count total sells
    const totalSells = transactions.filter(tx => tx.type?.toLowerCase() === 'sell').length;
    
    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Token Data');
    
    // Helper function to format timestamp
    const formatTimestamp = (dateString: string | null | undefined): string => {
      if (!dateString) return '';
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };
    
    // Helper function to format token amounts
    const formatTokenAmount = (amount: number | string): string => {
      const num = parseFloat(String(amount));
      if (!num || isNaN(num)) return '';
      
      if (num >= 1e12) {
        return `${(num / 1e12).toFixed(0)}T`;
      } else if (num >= 1e9) {
        return `${(num / 1e9).toFixed(0)}B`;
      } else if (num >= 1e6) {
        return `${(num / 1e6).toFixed(0)}M`;
      } else if (num >= 1e3) {
        return `${(num / 1e3).toFixed(0)}K`;
      }
      return num.toString();
    };
    
    // Helper function to format market cap with 3 decimals
    const formatMarketCap = (amount: number | string | null | undefined): string => {
      if (!amount) return '';
      const num = parseFloat(String(amount));
      if (!num || isNaN(num)) return '';
      
      if (num >= 1e12) {
        return `$${(num / 1e12).toFixed(3)}T`;
      } else if (num >= 1e9) {
        return `$${(num / 1e9).toFixed(3)}B`;
      } else if (num >= 1e6) {
        return `$${(num / 1e6).toFixed(3)}M`;
      } else if (num >= 1e3) {
        return `$${(num / 1e3).toFixed(3)}K`;
      }
      return `$${num.toFixed(3)}`;
    };
    
    // Define dark green color
    const darkGreen = { argb: 'FF006400' };
    const white = { argb: 'FFFFFFFF' };
    const black = { argb: 'FF000000' };
    
    // Row 1: Token info headers
    const tokenInfoHeaders = [
      'Token Name',
      'Symbol',
      'Token Address',
      'Creator Address',
      'Dev Buy Amount SOL',
      'Dev Buy Amount Tokens',
      'Number of Socials',
      'Total Sells'
    ];
    
    const headerRow1 = worksheet.addRow(tokenInfoHeaders);
    headerRow1.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: darkGreen
      };
      cell.font = {
        color: white,
        bold: true
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };
      cell.border = {
        top: { style: 'thin', color: black },
        bottom: { style: 'thin', color: black },
        left: { style: 'thin', color: black },
        right: { style: 'thin', color: black }
      };
    });
    
    // Row 2: Token info data
    const tokenInfoRow = [
      tokenInfo?.token_name || 'Unknown',
      tokenInfo?.symbol || '???',
      token,
      tokenInfo?.creator || walletTokenInfo?.creator || '',
      walletTokenInfo?.dev_buy_amount && walletTokenInfo?.dev_buy_amount_decimal !== null
        ? parseFloat(walletTokenInfo.dev_buy_amount) / Math.pow(10, walletTokenInfo.dev_buy_amount_decimal)
        : '',
      walletTokenInfo?.dev_buy_token_amount && walletTokenInfo?.dev_buy_token_amount_decimal !== null
        ? parseFloat(walletTokenInfo.dev_buy_token_amount) / Math.pow(10, walletTokenInfo.dev_buy_token_amount_decimal)
        : '',
      0, // Number of Socials
      totalSells || 0 // Total Sells
    ];
    
    const dataRow1 = worksheet.addRow(tokenInfoRow);
    dataRow1.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: darkGreen
      };
      cell.font = {
        color: white
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };
      cell.border = {
        top: { style: 'thin', color: black },
        bottom: { style: 'thin', color: black },
        left: { style: 'thin', color: black },
        right: { style: 'thin', color: black }
      };
    });
    
    // Row 3: Transaction headers
    const transactionHeaders = [
      '', // Empty column
      'Event',
      'Market Cap',
      'Solscan transaction signature',
      'Timestamp',
      'Time from last transaction',
      'Transaction size in SOL',
      'Transaction Size in Tokens',
      'Transaction Gas & Tips'
    ];
    
    const headerRow2 = worksheet.addRow(transactionHeaders);
    headerRow2.eachCell((cell) => {
      cell.font = {
        bold: true
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };
    });
    
    // Transaction rows
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    
    transactions.forEach((tx: any, index: number) => {
      const event = tx.type?.charAt(0).toUpperCase() + tx.type?.slice(1).toLowerCase() || 'Unknown';
      const marketCap = formatMarketCap(tx.marketCap);
      const signature = tx.transaction_id || '';
      const timestamp = formatTimestamp(tx.created_at);
      
      // Calculate time from last transaction
      let timeFromLast = '';
      if (index > 0) {
        const prevTime = new Date(transactions[index - 1].created_at);
        const currentTime = new Date(tx.created_at);
        const diffMs = prevTime.getTime() - currentTime.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffDays > 0) {
          timeFromLast = `${diffDays}d ${diffHours % 24}h`;
        } else if (diffHours > 0) {
          timeFromLast = `${diffHours}h ${diffMins % 60}m`;
        } else {
          timeFromLast = `${diffMins}m`;
        }
      }
      
      // Transaction size in SOL
      const isBuy = tx.mint_from === SOL_MINT;
      const solAmount = isBuy ? (parseFloat(tx.in_amount) || 0) : (parseFloat(tx.out_amount) || 0);
      const transactionSizeSOL = `${(solAmount / 1000000000).toFixed(3)} SOL`;
      
      // Transaction size in Tokens
      const tokenAmount = isBuy ? (parseFloat(tx.out_amount) || 0) : (parseFloat(tx.in_amount) || 0);
      const transactionSizeTokens = formatTokenAmount(tokenAmount);
      
      // Transaction Gas & Tips
      const tipAmount = (tx.tipAmount != null ? parseFloat(tx.tipAmount) : 0) || 0;
      const feeAmount = (tx.feeAmount != null ? parseFloat(tx.feeAmount) : 0) || 0;
      const totalGasAndTips = feeAmount + tipAmount;
      const tipLabel = tipAmount > 0 ? 'Priority Tip' : 'No Tip';
      const gasAndTips = `${feeAmount.toFixed(9)} (Fee) + ${tipAmount.toFixed(9)} (${tipLabel}) = ${totalGasAndTips.toFixed(9)} SOL`;
      
      const row = worksheet.addRow([
        '', // Empty column
        event,
        marketCap,
        signature,
        timestamp,
        timeFromLast,
        transactionSizeSOL,
        transactionSizeTokens,
        gasAndTips
      ]);
      
      // Center align all cells in transaction rows
      row.eachCell((cell) => {
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle'
        };
      });
    });
    
    // Auto-size columns
    worksheet.columns.forEach((column) => {
      if (column && column.eachCell) {
        let maxLength = 10;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const cellValue = cell.value ? String(cell.value) : '';
          if (cellValue.length > maxLength) {
            maxLength = Math.min(cellValue.length + 2, 50);
          }
        });
        column.width = maxLength;
      }
    });
    
    // Set response headers
    const tokenSymbol = tokenInfo?.symbol || 'Token';
    const filename = `${tokenSymbol}_${wallet.substring(0, 8)}_${Date.now()}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Write workbook to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/wallets - Get all unique wallet addresses from transactions table
 */
app.get("/api/wallets", requireAuth, async (req, res) => {
  try {
    const wallets = await dbService.getAllWalletsFromTransactions();
    res.json({ success: true, wallets });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analyze/:wallet - Analyze wallet information (shows trading history from wallets table)
 */
app.get("/api/analyze/:wallet", requireAuth, async (req, res) => {
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
    
    // Get the earliest transaction timestamp for this wallet (tracking start time)
    // This is used when calculating holding duration for tokens bought before tracking started
    let trackingStartTime: string | null = null;
    try {
      const earliestTx = await dbService.getEarliestTransactionForWallet(wallet);
      if (earliestTx) {
        trackingStartTime = earliestTx.created_at;
      }
    } catch (error) {
      console.error('Failed to get earliest transaction for wallet:', error);
    }
    
    /**
     * Format duration in human-readable format
     * @param durationSeconds - Duration in seconds
     * @returns Formatted duration string
     */
    const formatDuration = (durationSeconds: number): string => {
      // Format: SS sec or MM min SS sec or HH h MM min or DD days ago
      if (durationSeconds < 60) {
        return `${durationSeconds} sec`;
      } else if (durationSeconds < 3600) {
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
      } else if (durationSeconds < 86400) {
        const hours = Math.floor(durationSeconds / 3600);
        const minutes = Math.floor((durationSeconds % 3600) / 60);
        return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
      } else {
        const days = Math.floor(durationSeconds / 86400);
        return `${days} day${days > 1 ? 's' : ''} ago`;
      }
    };
    
    /**
     * Calculate and format holding duration until first sell
     * @param buyTimestamp - First buy timestamp
     * @param sellTimestamp - First sell timestamp
     * @returns Formatted duration string or null
     */
    const formatHoldingDuration = (buyTimestamp: string | null, sellTimestamp: string | null): string | null => {
      // If buy date exists but sell date is missing, skip it (hasn't sold yet)
      if (buyTimestamp && !sellTimestamp) {
        return null;
      }
      
      // If both are missing, return null
      if (!sellTimestamp) {
        return null;
      }
      
      let startDate: Date;
      
      // If sell date exists but buy date is missing, use tracking start time (bought before stream)
      if (sellTimestamp && !buyTimestamp) {
        if (!trackingStartTime) {
          // No tracking start time available, cannot calculate
          return null;
        }
        startDate = new Date(trackingStartTime);
      } else if (buyTimestamp && sellTimestamp) {
        // Both exist, use buy timestamp
        startDate = new Date(buyTimestamp);
      } else {
        return null;
      }
      
      // Calculate duration in seconds
      const sellDate = new Date(sellTimestamp);
      const durationSeconds = Math.floor((sellDate.getTime() - startDate.getTime()) / 1000);
      
      // Ensure positive duration
      if (durationSeconds < 0) {
        return null;
      }
      
      return formatDuration(durationSeconds);
    };

    // Format trading data for frontend (with total sells amount and buy amounts)
    const tradingData = await Promise.all(walletTrades.map(async (trade: any) => {
      // Get total SOL amount from sell events for this wallet-token pair
      const totalSellsAmount = await dbService.getTotalSellsForWalletToken(wallet, trade.token_address);
      
      // Get total SOL amount spent in buy transactions
      const totalBuyAmount = await dbService.getTotalBuyAmountForWalletToken(wallet, trade.token_address);
      
      // Get total token amount received in buy transactions
      // Use dev_buy_token_amount_decimal from tokens table if available, otherwise use first_buy_decimals
      const devBuyTokenDecimals = tokenInfo[trade.token_address]?.dev_buy_token_amount_decimal || null;
      const tokenDecimalsToUse = devBuyTokenDecimals !== null && devBuyTokenDecimals !== undefined && !isNaN(devBuyTokenDecimals)
        ? devBuyTokenDecimals
        : trade.first_buy_decimals;
      const totalBuyTokens = await dbService.getTotalBuyTokensForWalletToken(wallet, trade.token_address, tokenDecimalsToUse);
      
      return {
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
        total_sells: totalSellsAmount,
        total_buy_amount: totalBuyAmount, // Total SOL spent in buy transactions
        total_buy_tokens: totalBuyTokens, // Total token amount received in buy transactions
        holding_duration: formatHoldingDuration(trade.first_buy_timestamp, trade.first_sell_timestamp),
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
      };
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
app.post("/api/tokens/fetch-info", requireAuth, async (req, res) => {
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
app.get("/api/skip-tokens", requireAuth, async (req, res) => {
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
app.post("/api/skip-tokens", requireAuth, async (req, res) => {
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
app.delete("/api/skip-tokens/:mintAddress", requireAuth, async (req, res) => {
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

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error: Error) => {
  // Log the error (to file, not console to avoid EPIPE)
  try {
    const fs = require('fs');
    const path = require('path');
    const logDir = path.join(process.cwd(), 'logs');
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `app-${today}.log`);
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] [FATAL] Uncaught Exception: ${error.message}\n${error.stack}\n`;
    fs.appendFileSync(logFile, errorMessage, 'utf8');
  } catch {
    // If logging fails, silently ignore
  }
  
  // Try to log to console (but don't crash if it fails)
  try {
    console.error('Fatal: Uncaught exception:', error);
  } catch {
    // Ignore EPIPE and other console errors
  }
  
  // Give some time for cleanup, then exit
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  // Log the error (to file, not console to avoid EPIPE)
  try {
    const fs = require('fs');
    const path = require('path');
    const logDir = path.join(process.cwd(), 'logs');
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `app-${today}.log`);
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] [FATAL] Unhandled Rejection: ${reason}\n${reason?.stack || ''}\n`;
    fs.appendFileSync(logFile, errorMessage, 'utf8');
  } catch {
    // If logging fails, silently ignore
  }
  
  // Try to log to console (but don't crash if it fails)
  try {
    console.error('Fatal: Unhandled rejection:', reason);
  } catch {
    // Ignore EPIPE and other console errors
  }
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  try {
    console.log('\n⏸️  Shutting down gracefully...');
  } catch {
    // Ignore EPIPE errors during shutdown
  }
  await tracker.stop();
  await dbService.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  try {
    console.log('\n⏸️  Shutting down gracefully...');
  } catch {
    // Ignore EPIPE errors during shutdown
  }
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

