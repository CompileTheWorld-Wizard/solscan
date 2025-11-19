require("dotenv").config();
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import session from "express-session";
import ExcelJS from "exceljs";
import crypto from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
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
const HARDCODED_PASSWORD = 'admin123'; // Fallback for initial setup
const SESSION_SECRET = process.env.SESSION_SECRET || 'your-secret-key-change-in-production';

/**
 * Hash a password using SHA-256
 */
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Verify a password against a hash
 */
function verifyPassword(password: string, hash: string): boolean {
  const passwordHash = hashPassword(password);
  return passwordHash === hash;
}

// Trust proxy (important if behind reverse proxy like nginx)
// This ensures proper IP detection and cookie handling
if (process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

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
    secure: process.env.NODE_ENV === 'production' && process.env.USE_HTTPS === 'true', // Only use secure cookies if explicitly using HTTPS
    httpOnly: true,
    sameSite: 'lax', // Helpful for cross-site requests and ensures cookies work properly
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/' // Ensure cookie is available for all paths
  },
  name: 'solscan.sid' // Custom session name
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
app.post("/api/login", async (req, res) => {
  const { password } = req.body;
  
  try {
    // Check database for password hash
    const passwordHash = await dbService.getPasswordHash();
    
    let isValid = false;
    
    if (passwordHash) {
      // Verify against database hash
      isValid = verifyPassword(password, passwordHash);
    } else {
      // Fallback to hardcoded password for initial setup
      isValid = password === HARDCODED_PASSWORD;
      
      // If login successful with hardcoded password, save it to database
      if (isValid) {
        const hash = hashPassword(password);
        await dbService.updatePasswordHash(hash);
        console.log('✅ Initial password saved to database');
      }
    }
    
    if (isValid) {
      req.session.authenticated = true;
      // Save session explicitly to ensure it's persisted
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ success: false, error: 'Failed to save session' });
        }
        res.json({ success: true, message: 'Login successful' });
      });
    } else {
      res.status(401).json({ success: false, error: 'Invalid password' });
    }
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
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

/**
 * POST /api/change-password - Change password endpoint (protected)
 */
app.post("/api/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required' });
    }
    
    // Validate new password requirements
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long' });
    }
    
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'New password must contain at least one uppercase letter' });
    }
    
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'New password must contain at least one number' });
    }
    
    // Get current password hash from database
    const passwordHash = await dbService.getPasswordHash();
    
    // Verify current password
    let currentPasswordValid = false;
    if (passwordHash) {
      currentPasswordValid = verifyPassword(currentPassword, passwordHash);
    } else {
      // Fallback to hardcoded password if no hash in database
      currentPasswordValid = currentPassword === HARDCODED_PASSWORD;
    }
    
    if (!currentPasswordValid) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }
    
    // Hash and save new password
    const newPasswordHash = hashPassword(newPassword);
    await dbService.updatePasswordHash(newPasswordHash);
    
    console.log('✅ Password changed successfully');
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, error: 'Failed to change password. Please try again.' });
  }
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
    const walletTradesResult = await walletTrackingService.getWalletTokens(wallet);
    const walletTrades = walletTradesResult.data;
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
 * New format: One row per token with all information in that row
 */
app.get("/api/export-token-excel/:wallet/:token", requireAuth, async (req, res) => {
  try {
    const { wallet, token } = req.params;
    
    // Get token information
    const tokens = await dbService.getTokensByMints([token]);
    const tokenInfo = tokens.length > 0 ? tokens[0] : null;
    
    // Get wallet token info
    const walletTradesResult = await walletTrackingService.getWalletTokens(wallet);
    const walletTrades = walletTradesResult.data;
    const walletTokenInfo = walletTrades.find((t: any) => t.token_address === token) || null;
    
    // Get all transactions for this wallet+token pair
    const transactions = await dbService.getTransactionsByWalletToken(wallet, token);
    
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
    
    // Helper function to format market cap with K and M
    const formatMarketCap = (marketCap: number | string | null | undefined): string => {
      if (!marketCap) return '';
      const num = parseFloat(String(marketCap));
      if (!num || isNaN(num)) return '';
      
      if (num >= 1000000) {
        return `${(num / 1000000).toFixed(2)}M`;
      } else if (num >= 1000) {
        return `${(num / 1000).toFixed(2)}K`;
      }
      return num.toFixed(2);
    };
    
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    
    // Count sells for this token
    const sells = transactions.filter((tx: any) => tx.type?.toLowerCase() === 'sell');
    const numSells = sells.length;
    
    // Build header row
    const baseHeaders = [
      'Token Name',
      'Token Symbol',
      'Token Address',
      'Creator Address',
      'Number of Socials',
      'Dev Buy Amount in SOL',
      'Dev Buy Amount in Tokens',
      'Wallet Gas & Fees Amount',
      'Wallet Buy Position After Dev',
      'Wallet Buy Block #',
      'Wallet Buy Block # After Dev',
      'Wallet Buy Timestamp',
      'Transaction Signature',
      'Wallet Buy Amount in SOL',
      'Wallet Buy Amount in Tokens',
      'Wallet Buy Market Cap'
    ];
    
    // Add sell columns for each sell
    const sellHeaders: string[] = [];
    for (let i = 1; i <= numSells; i++) {
      sellHeaders.push(
        `Wallet Sell Number`,
        `Wallet Sell Timestamp`,
        `Transaction Signature`,
        `Wallet Sell Amount in SOL`,
        `Wallet Sell Amount in Tokens`,
        `Wallet Sell Market Cap`
      );
    }
    
    const headers = [...baseHeaders, ...sellHeaders];
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF006400' }
      };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
    });
    
    // Sort transactions by block timestamp ASC (fallback to created_at if block_timestamp not available)
    transactions.sort((a: any, b: any) => {
      const timeA = a.blockTimestamp ? new Date(a.blockTimestamp).getTime() : new Date(a.created_at).getTime();
      const timeB = b.blockTimestamp ? new Date(b.blockTimestamp).getTime() : new Date(b.created_at).getTime();
      return timeA - timeB;
    });
    
    // Calculate social links count
    let socialCount = 0;
    if (tokenInfo?.twitter) socialCount++;
    if (tokenInfo?.website) socialCount++;
    if (tokenInfo?.discord) socialCount++;
    if (tokenInfo?.telegram) socialCount++;
    
    // Dev buy amounts
    const devBuyAmountSOL = tokenInfo?.dev_buy_amount && tokenInfo?.dev_buy_amount_decimal !== null
      ? parseFloat(tokenInfo.dev_buy_amount) / Math.pow(10, tokenInfo.dev_buy_amount_decimal)
      : null;
    const devBuyAmountTokens = tokenInfo?.dev_buy_token_amount && tokenInfo?.dev_buy_token_amount_decimal !== null
      ? parseFloat(tokenInfo.dev_buy_token_amount) / Math.pow(10, tokenInfo.dev_buy_token_amount_decimal)
      : null;
    
    // Get dev buy timestamp and block number
    const devBuyTimestamp = tokenInfo?.dev_buy_timestamp ? new Date(tokenInfo.dev_buy_timestamp).getTime() : null;
    const devBuyBlockNumber = tokenInfo?.dev_buy_block_number || null;
    
    // Find first buy transaction for this wallet-token pair (sorted by timestamp ASC)
    const buys = transactions.filter((tx: any) => tx.type?.toLowerCase() === 'buy' && tx.mint_from === SOL_MINT);
    const firstBuy = buys.length > 0 ? buys[0] : null; // First buy is already first in sorted array
    
    // Get token decimals
    const tokenDecimals = tokenInfo?.dev_buy_token_amount_decimal !== null && tokenInfo?.dev_buy_token_amount_decimal !== undefined
      ? tokenInfo.dev_buy_token_amount_decimal
      : 9;
    
    // Build base row data
    const rowData: any[] = [
      tokenInfo?.token_name || 'Unknown',
      tokenInfo?.symbol || '???',
      token,
      tokenInfo?.creator || '',
      socialCount,
      devBuyAmountSOL !== null ? devBuyAmountSOL : '',
      devBuyAmountTokens !== null ? devBuyAmountTokens : '',
      '', // Wallet Gas & Fees Amount (will fill if firstBuy exists)
      '', // Wallet Buy Position After Dev
      '', // Wallet Buy Block #
      '', // Wallet Buy Block # After Dev
      '', // Wallet Buy Timestamp
      '', // Transaction Signature
      '', // Wallet Buy Amount in SOL
      '', // Wallet Buy Amount in Tokens
      ''  // Wallet Buy Market Cap
    ];
    
    // Fill first buy data if exists
    if (firstBuy) {
      // Gas & Fees for first buy only
      const tipAmount = (firstBuy.tipAmount != null ? parseFloat(firstBuy.tipAmount) : 0) || 0;
      const feeAmount = (firstBuy.feeAmount != null ? parseFloat(firstBuy.feeAmount) : 0) || 0;
      const totalGasAndTips = feeAmount + tipAmount;
      rowData[7] = totalGasAndTips; // Wallet Gas & Fees Amount
      
      // Calculate position after dev (milliseconds) - only if buy happens after dev buy
      if (devBuyTimestamp) {
        const buyTime = new Date(firstBuy.created_at).getTime();
        const millisecondsDiff = buyTime - devBuyTimestamp;
        // Only show if buy happened after dev buy (positive value)
        rowData[8] = millisecondsDiff >= 0 ? millisecondsDiff : ''; // Wallet Buy Position After Dev
      }
      
      // Block number
      rowData[9] = firstBuy.blockNumber || ''; // Wallet Buy Block #
      
      // Block number after dev
      if (devBuyBlockNumber && firstBuy.blockNumber) {
        rowData[10] = firstBuy.blockNumber - devBuyBlockNumber; // Wallet Buy Block # After Dev
      }
      
      // Timestamp
      rowData[11] = formatTimestamp(firstBuy.created_at); // Wallet Buy Timestamp
      
      // Transaction signature
      rowData[12] = firstBuy.transaction_id || ''; // Transaction Signature
      
      // Buy amount in SOL
      const buySolAmount = parseFloat(firstBuy.in_amount) || 0;
      rowData[13] = buySolAmount / 1000000000; // Wallet Buy Amount in SOL
      
      // Buy amount in Tokens
      const buyTokenAmountRaw = parseFloat(firstBuy.out_amount) || 0;
      rowData[14] = buyTokenAmountRaw / Math.pow(10, tokenDecimals); // Wallet Buy Amount in Tokens
      
      // Market cap (raw value, not formatted)
      rowData[15] = firstBuy.marketCap || ''; // Wallet Buy Market Cap
    }
    
    // Get all sells (sorted by block timestamp ASC, fallback to created_at)
    const sortedSells = transactions
      .filter((tx: any) => tx.type?.toLowerCase() === 'sell')
      .sort((a: any, b: any) => {
        const timeA = a.blockTimestamp ? new Date(a.blockTimestamp).getTime() : new Date(a.created_at).getTime();
        const timeB = b.blockTimestamp ? new Date(b.blockTimestamp).getTime() : new Date(b.created_at).getTime();
        return timeA - timeB;
      });
    
    // Helper function to format ordinal numbers (1st, 2nd, 3rd, etc.)
    const formatOrdinal = (n: number): string => {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };
    
    // Add sell data (repeated columns)
    for (let i = 0; i < numSells; i++) {
      const sell = sortedSells[i];
      rowData.push(
        formatOrdinal(i + 1), // Wallet Sell Number (1st, 2nd, 3rd, etc.)
        formatTimestamp(sell.blockTimestamp || sell.created_at), // Wallet Sell Timestamp (use block_timestamp if available)
        sell.transaction_id || '', // Transaction Signature
        (parseFloat(sell.out_amount) || 0) / 1000000000, // Wallet Sell Amount in SOL
        (parseFloat(sell.in_amount) || 0) / Math.pow(10, tokenDecimals), // Wallet Sell Amount in Tokens
        sell.marketCap || '' // Wallet Sell Market Cap (raw value, not formatted)
      );
    }
    
    // Add row to worksheet
    const row = worksheet.addRow(rowData);
    row.eachCell((cell) => {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
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
 * GET /api/export-all-tokens-excel/:wallet - Generate Excel file with all tokens data
 * New format: One row per token with all information in that row
 */
app.get("/api/export-all-tokens-excel/:wallet", requireAuth, async (req, res) => {
  try {
    const { wallet } = req.params;
    
    // Get all wallet trades
    const walletTradesResult = await walletTrackingService.getWalletTokens(wallet);
    const walletTrades = walletTradesResult.data;
    
    if (!walletTrades || walletTrades.length === 0) {
      return res.status(404).json({ success: false, error: 'No tokens found for this wallet' });
    }
    
    // Get all token mints
    const tokenMints = walletTrades.map((trade: any) => trade.token_address);
    
    // Get token information for all tokens
    const tokens = await dbService.getTokensByMints(tokenMints);
    const tokenInfoMap = new Map();
    tokens.forEach((token: any) => {
      tokenInfoMap.set(token.mint_address, token);
    });
    
    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('All Tokens Data');
    
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
    
    // Helper function to format market cap with K and M
    const formatMarketCap = (marketCap: number | string | null | undefined): string => {
      if (!marketCap) return '';
      const num = parseFloat(String(marketCap));
      if (!num || isNaN(num)) return '';
      
      if (num >= 1000000) {
        return `${(num / 1000000).toFixed(2)}M`;
      } else if (num >= 1000) {
        return `${(num / 1000).toFixed(2)}K`;
      }
      return num.toFixed(2);
    };
    
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    
    // Find maximum number of sells across all tokens to determine column count
    let maxSells = 0;
    for (const trade of walletTrades) {
      const transactions = await dbService.getTransactionsByWalletToken(wallet, trade.token_address);
      const sells = transactions.filter((tx: any) => tx.type?.toLowerCase() === 'sell');
      if (sells.length > maxSells) {
        maxSells = sells.length;
      }
    }
    
    // Build header row
    const baseHeaders = [
      'Token Name',
      'Token Symbol',
      'Token Address',
      'Creator Address',
      'Number of Socials',
      'Dev Buy Amount in SOL',
      'Dev Buy Amount in Tokens',
      'Wallet Gas & Fees Amount',
      'Wallet Buy Position After Dev',
      'Wallet Buy Block #',
      'Wallet Buy Block # After Dev',
      'Wallet Buy Timestamp',
      'Transaction Signature',
      'Wallet Buy Amount in SOL',
      'Wallet Buy Amount in Tokens',
      'Wallet Buy Market Cap'
    ];
    
    // Add sell columns for each sell (up to maxSells)
    const sellHeaders: string[] = [];
    for (let i = 1; i <= maxSells; i++) {
      sellHeaders.push(
        `Wallet Sell Number`,
        `Wallet Sell Timestamp`,
        `Transaction Signature`,
        `Wallet Sell Amount in SOL`,
        `Wallet Sell Amount in Tokens`,
        `Wallet Sell Market Cap`
      );
    }
    
    const headers = [...baseHeaders, ...sellHeaders];
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF006400' }
      };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
    });
    
    // Process each token - one row per token
    for (const trade of walletTrades) {
      const token = trade.token_address;
      const tokenInfo = tokenInfoMap.get(token) || null;
      
      // Get all transactions for this wallet+token pair (sorted by block_timestamp ASC)
      const transactions = await dbService.getTransactionsByWalletToken(wallet, token);
      
      // Sort transactions by block timestamp ASC (fallback to created_at if block_timestamp not available)
      transactions.sort((a: any, b: any) => {
        const timeA = a.blockTimestamp ? new Date(a.blockTimestamp).getTime() : new Date(a.created_at).getTime();
        const timeB = b.blockTimestamp ? new Date(b.blockTimestamp).getTime() : new Date(b.created_at).getTime();
        return timeA - timeB;
      });
      
      // Calculate social links count
      let socialCount = 0;
      if (tokenInfo?.twitter) socialCount++;
      if (tokenInfo?.website) socialCount++;
      if (tokenInfo?.discord) socialCount++;
      if (tokenInfo?.telegram) socialCount++;
      
      // Dev buy amounts
      const devBuyAmountSOL = tokenInfo?.dev_buy_amount && tokenInfo?.dev_buy_amount_decimal !== null
        ? parseFloat(tokenInfo.dev_buy_amount) / Math.pow(10, tokenInfo.dev_buy_amount_decimal)
        : null;
      const devBuyAmountTokens = tokenInfo?.dev_buy_token_amount && tokenInfo?.dev_buy_token_amount_decimal !== null
        ? parseFloat(tokenInfo.dev_buy_token_amount) / Math.pow(10, tokenInfo.dev_buy_token_amount_decimal)
        : null;
      
      // Get dev buy timestamp and block number
      const devBuyTimestamp = tokenInfo?.dev_buy_timestamp ? new Date(tokenInfo.dev_buy_timestamp).getTime() : null;
      const devBuyBlockNumber = tokenInfo?.dev_buy_block_number || null;
      
      // Find first buy transaction for this wallet-token pair (sorted by timestamp ASC)
      const buys = transactions.filter((tx: any) => tx.type?.toLowerCase() === 'buy' && tx.mint_from === SOL_MINT);
      const firstBuy = buys.length > 0 ? buys[0] : null; // First buy is already first in sorted array
      
      // Get token decimals
      const tokenDecimals = tokenInfo?.dev_buy_token_amount_decimal !== null && tokenInfo?.dev_buy_token_amount_decimal !== undefined
        ? tokenInfo.dev_buy_token_amount_decimal
        : 9;
      
      // Build base row data
      const rowData: any[] = [
        tokenInfo?.token_name || 'Unknown',
        tokenInfo?.symbol || '???',
        token,
        tokenInfo?.creator || '',
        socialCount,
        devBuyAmountSOL !== null ? devBuyAmountSOL : '',
        devBuyAmountTokens !== null ? devBuyAmountTokens : '',
        '', // Wallet Gas & Fees Amount (will fill if firstBuy exists)
        '', // Wallet Buy Position After Dev
        '', // Wallet Buy Block #
        '', // Wallet Buy Block # After Dev
        '', // Wallet Buy Timestamp
        '', // Transaction Signature
        '', // Wallet Buy Amount in SOL
        '', // Wallet Buy Amount in Tokens
        ''  // Wallet Buy Market Cap
      ];
      
      // Fill first buy data if exists
      if (firstBuy) {
        // Gas & Fees for first buy only
        const tipAmount = (firstBuy.tipAmount != null ? parseFloat(firstBuy.tipAmount) : 0) || 0;
        const feeAmount = (firstBuy.feeAmount != null ? parseFloat(firstBuy.feeAmount) : 0) || 0;
        const totalGasAndTips = feeAmount + tipAmount;
        rowData[7] = totalGasAndTips; // Wallet Gas & Fees Amount
        
      // Calculate position after dev (milliseconds) - only if buy happens after dev buy
      // Use block_timestamp if available, otherwise fallback to created_at
      const buyTimestamp = firstBuy.blockTimestamp || firstBuy.created_at;
      if (devBuyTimestamp && buyTimestamp) {
        const buyTime = new Date(buyTimestamp).getTime();
        const millisecondsDiff = buyTime - devBuyTimestamp;
        // Only show if buy happened after dev buy (positive value)
        rowData[8] = millisecondsDiff >= 0 ? millisecondsDiff : ''; // Wallet Buy Position After Dev
      }
      
      // Block number
      rowData[9] = firstBuy.blockNumber || ''; // Wallet Buy Block #
      
      // Block number after dev
      if (devBuyBlockNumber && firstBuy.blockNumber) {
        rowData[10] = firstBuy.blockNumber - devBuyBlockNumber; // Wallet Buy Block # After Dev
      }
      
      // Timestamp (use block_timestamp if available)
      rowData[11] = formatTimestamp(buyTimestamp); // Wallet Buy Timestamp
        
        // Transaction signature
        rowData[12] = firstBuy.transaction_id || ''; // Transaction Signature
        
        // Buy amount in SOL
        const buySolAmount = parseFloat(firstBuy.in_amount) || 0;
        rowData[13] = buySolAmount / 1000000000; // Wallet Buy Amount in SOL
        
        // Buy amount in Tokens
        const buyTokenAmountRaw = parseFloat(firstBuy.out_amount) || 0;
        rowData[14] = buyTokenAmountRaw / Math.pow(10, tokenDecimals); // Wallet Buy Amount in Tokens
        
        // Market cap (raw value, not formatted)
        rowData[15] = firstBuy.marketCap || ''; // Wallet Buy Market Cap
      }
      
      // Get all sells (sorted by timestamp ASC)
      const sells = transactions
        .filter((tx: any) => tx.type?.toLowerCase() === 'sell')
        .sort((a: any, b: any) => {
          const timeA = new Date(a.created_at).getTime();
          const timeB = new Date(b.created_at).getTime();
          return timeA - timeB;
        });
      
      // Helper function to format ordinal numbers (1st, 2nd, 3rd, etc.)
      const formatOrdinal = (n: number): string => {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
      };
      
      // Add sell data (repeated columns)
      for (let i = 0; i < maxSells; i++) {
        if (i < sells.length) {
          const sell = sells[i];
          rowData.push(
            formatOrdinal(i + 1), // Wallet Sell Number (1st, 2nd, 3rd, etc.)
            formatTimestamp(sell.blockTimestamp || sell.created_at), // Wallet Sell Timestamp (use block_timestamp if available)
            sell.transaction_id || '', // Transaction Signature
            (parseFloat(sell.out_amount) || 0) / 1000000000, // Wallet Sell Amount in SOL
            (parseFloat(sell.in_amount) || 0) / Math.pow(10, tokenDecimals), // Wallet Sell Amount in Tokens
            sell.marketCap || '' // Wallet Sell Market Cap (raw value, not formatted)
          );
        } else {
          // Empty cells for missing sells
          rowData.push('', '', '', '', '', '');
        }
      }
      
      // Add row to worksheet
      const row = worksheet.addRow(rowData);
      row.eachCell((cell) => {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    }
    
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
    const filename = `AllTokens_${wallet.substring(0, 8)}_${Date.now()}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Write workbook to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('Export all tokens error:', error);
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
    
    // Get pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;
    const limit = pageSize;
    const offset = (page - 1) * pageSize;
    
    // Get wallet trading history from wallets table with pagination
    const walletTradesResult = await walletTrackingService.getWalletTokens(wallet, limit, offset);
    const walletTrades = walletTradesResult.data;
    const totalTrades = walletTradesResult.total;
    
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
        // Add social links
        twitter: tokenInfo[trade.token_address]?.twitter || null,
        website: tokenInfo[trade.token_address]?.website || null,
        discord: tokenInfo[trade.token_address]?.discord || null,
        telegram: tokenInfo[trade.token_address]?.telegram || null,
      };
    }));
    
    res.json({
      wallet: wallet,
      trades: tradingData,
      totalTrades: totalTrades,
      page: page,
      pageSize: pageSize,
      totalPages: Math.ceil(totalTrades / pageSize),
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
            dev_buy_timestamp: tokenInfo.devBuyTimestamp || null,
            dev_buy_block_number: tokenInfo.devBuyBlockNumber || null,
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

/**
 * DELETE /api/wallets/:walletAddress - Remove wallet and all its transactions from database
 */
app.delete("/api/wallets/:walletAddress", requireAuth, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress || walletAddress.trim().length === 0) {
      return res.status(400).json({ error: "Wallet address is required" });
    }
    
    const result = await dbService.deleteWalletAndTransactions(walletAddress);
    
    res.json({ 
      success: true,
      message: "Wallet and transactions removed successfully",
      transactionsDeleted: result.transactionsDeleted,
      walletsDeleted: result.walletsDeleted
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get total buy and sell transaction counts for a wallet
 * @param walletAddress - The wallet address to check
 * @returns Object with totalBuys and totalSells counts
 */
async function getWalletBuySellCounts(walletAddress: string): Promise<{ totalBuys: number; totalSells: number }> {
  try {
    return await dbService.getWalletBuySellCounts(walletAddress);
  } catch (error: any) {
    console.error(`Error getting buy/sell counts for ${walletAddress}:`, error);
    return { totalBuys: 0, totalSells: 0 };
  }
}

/**
 * GET /api/dashboard-data/:wallet - Get dashboard data for a wallet
 * Returns comprehensive token data with all calculated metrics
 */
app.get("/api/dashboard-data/:wallet", requireAuth, async (req, res) => {
  try {
    const { wallet } = req.params;
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const SOL_DECIMALS = 9;
    
    // Get total buy/sell counts
    const { totalBuys, totalSells } = await getWalletBuySellCounts(wallet);
    
    // Get average open position
    const averageOpenPosition = await dbService.getWalletAverageOpenPosition(wallet);
    
    // Get all wallet trades
    const walletTradesResult = await walletTrackingService.getWalletTokens(wallet);
    const walletTrades = walletTradesResult.data;
    
    if (!walletTrades || walletTrades.length === 0) {
      return res.json({ success: true, data: [], totalBuys, totalSells, averageOpenPosition });
    }
    
    // Get all token mints
    const tokenMints = walletTrades.map((trade: any) => trade.token_address);
    
    // Get token information for all tokens
    const tokens = await dbService.getTokensByMints(tokenMints);
    const tokenInfoMap = new Map();
    tokens.forEach((token: any) => {
      tokenInfoMap.set(token.mint_address, token);
    });
    
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
    
    // Process each token
    const dashboardData = await Promise.all(walletTrades.map(async (trade: any) => {
      const token = trade.token_address;
      const tokenInfo = tokenInfoMap.get(token) || null;
      
      // Get all transactions for this wallet+token pair
      const transactions = await dbService.getTransactionsByWalletToken(wallet, token);
      
      // Sort transactions by block timestamp ASC
      transactions.sort((a: any, b: any) => {
        const timeA = a.blockTimestamp ? new Date(a.blockTimestamp).getTime() : new Date(a.created_at).getTime();
        const timeB = b.blockTimestamp ? new Date(b.blockTimestamp).getTime() : new Date(b.created_at).getTime();
        return timeA - timeB;
      });
      
      // Calculate social links count
      let socialCount = 0;
      if (tokenInfo?.twitter) socialCount++;
      if (tokenInfo?.website) socialCount++;
      if (tokenInfo?.discord) socialCount++;
      if (tokenInfo?.telegram) socialCount++;
      
      // Dev buy amounts
      const devBuyAmountSOL = tokenInfo?.dev_buy_amount && tokenInfo?.dev_buy_amount_decimal !== null
        ? parseFloat(tokenInfo.dev_buy_amount) / Math.pow(10, tokenInfo.dev_buy_amount_decimal)
        : null;
      const devBuyAmountTokens = tokenInfo?.dev_buy_token_amount && tokenInfo?.dev_buy_token_amount_decimal !== null
        ? parseFloat(tokenInfo.dev_buy_token_amount) / Math.pow(10, tokenInfo.dev_buy_token_amount_decimal)
        : null;
      
      // Get dev buy timestamp and block number
      const devBuyTimestamp = tokenInfo?.dev_buy_timestamp ? new Date(tokenInfo.dev_buy_timestamp).getTime() : null;
      const devBuyBlockNumber = tokenInfo?.dev_buy_block_number || null;
      
      // Find first buy transaction
      const buys = transactions.filter((tx: any) => tx.type?.toLowerCase() === 'buy' && tx.mint_from === SOL_MINT);
      const firstBuy = buys.length > 0 ? buys[0] : null;
      
      // Get token decimals
      const tokenDecimals = tokenInfo?.dev_buy_token_amount_decimal !== null && tokenInfo?.dev_buy_token_amount_decimal !== undefined
        ? tokenInfo.dev_buy_token_amount_decimal
        : 9;
      
      // Calculate wallet buy amounts (from first buy transaction)
      const walletBuyAmountSOL = firstBuy ? (parseFloat(firstBuy.in_amount) || 0) / Math.pow(10, SOL_DECIMALS) : 0;
      const walletBuyAmountTokens = firstBuy ? (parseFloat(firstBuy.out_amount) || 0) / Math.pow(10, tokenDecimals) : 0;
      
      // Get total gas and fees for all transactions
      let totalGasAndFees = 0;
      transactions.forEach((tx: any) => {
        const tipAmount = (tx.tipAmount != null ? parseFloat(tx.tipAmount) : 0) || 0;
        const feeAmount = (tx.feeAmount != null ? parseFloat(tx.feeAmount) : 0) || 0;
        totalGasAndFees += (tipAmount + feeAmount);
      });
      
      // Get all sells (sorted by timestamp ASC)
      const sells = transactions
        .filter((tx: any) => tx.type?.toLowerCase() === 'sell')
        .sort((a: any, b: any) => {
          const timeA = a.blockTimestamp ? new Date(a.blockTimestamp).getTime() : new Date(a.created_at).getTime();
          const timeB = b.blockTimestamp ? new Date(b.blockTimestamp).getTime() : new Date(b.created_at).getTime();
          return timeA - timeB;
        });
      
      // Calculate total sell amount in SOL
      const totalSellAmountSOL = sells.reduce((sum: number, sell: any) => {
        return sum + ((parseFloat(sell.out_amount) || 0) / Math.pow(10, SOL_DECIMALS));
      }, 0);
      
      // Calculate PNL
      const pnlSOL = totalSellAmountSOL - (walletBuyAmountSOL + totalGasAndFees);
      const pnlPercent = walletBuyAmountSOL > 0 ? (pnlSOL / walletBuyAmountSOL) * 100 : 0;
      
      // Get first buy market cap and total supply
      const firstBuyMarketCap = firstBuy?.marketCap || null;
      const firstBuyTotalSupply = firstBuy?.totalSupply ? parseFloat(firstBuy.totalSupply) : null;
      
      // Calculate percentages
      const walletBuySOLPercentOfDev = devBuyAmountSOL && devBuyAmountSOL > 0 
        ? (walletBuyAmountSOL / devBuyAmountSOL) * 100 
        : null;
      const walletBuyTokensPercentOfDev = devBuyAmountTokens && devBuyAmountTokens > 0
        ? (walletBuyAmountTokens / devBuyAmountTokens) * 100
        : null;
      const devBuyTokensPercentOfTotalSupply = firstBuyTotalSupply && firstBuyTotalSupply > 0 && devBuyAmountTokens
        ? (devBuyAmountTokens / firstBuyTotalSupply) * 100
        : null;
      const walletBuyPercentOfTotalSupply = firstBuyTotalSupply && firstBuyTotalSupply > 0
        ? (walletBuyAmountTokens / firstBuyTotalSupply) * 100
        : null;
      const walletBuyPercentOfRemainingSupply = firstBuyTotalSupply && devBuyAmountTokens && (firstBuyTotalSupply - devBuyAmountTokens) > 0
        ? (walletBuyAmountTokens / (firstBuyTotalSupply - devBuyAmountTokens)) * 100
        : null;
      
      // Calculate position after dev (milliseconds)
      let walletBuyPositionAfterDev = null;
      if (devBuyTimestamp && firstBuy) {
        const buyTimestamp = firstBuy.blockTimestamp || firstBuy.created_at;
        if (buyTimestamp) {
          const buyTime = new Date(buyTimestamp).getTime();
          const millisecondsDiff = buyTime - devBuyTimestamp;
          walletBuyPositionAfterDev = millisecondsDiff >= 0 ? millisecondsDiff : null;
        }
      }
      
      // Calculate block number after dev
      const walletBuyBlockNumberAfterDev = devBuyBlockNumber && firstBuy?.blockNumber
        ? firstBuy.blockNumber - devBuyBlockNumber
        : null;
      
      // Get peak prices and market caps from database (pool monitoring data)
      const tokenPeakPriceBeforeFirstSell = trade.peak_buy_to_sell_price_usd ? parseFloat(trade.peak_buy_to_sell_price_usd.toString()) : null;
      const tokenPeakPrice10sAfterFirstSell = trade.peak_sell_to_end_price_usd ? parseFloat(trade.peak_sell_to_end_price_usd.toString()) : null;
      const tokenPeakMarketCapBeforeFirstSell = trade.peak_buy_to_sell_mcap ? parseFloat(trade.peak_buy_to_sell_mcap.toString()) : null;
      const tokenPeakMarketCap10sAfterFirstSell = trade.peak_sell_to_end_mcap ? parseFloat(trade.peak_sell_to_end_mcap.toString()) : null;
      
      // Get open position count at the time of buy
      const openPositionCount = trade.open_position_count !== null && trade.open_position_count !== undefined 
        ? parseInt(trade.open_position_count.toString(), 10) 
        : null;
      
      // Get buy timestamp for holding time calculation
      const buyTimestamp = firstBuy ? (firstBuy.blockTimestamp || firstBuy.created_at) : null;
      
      // Format sell transactions
      let cumulativeSellAmountSOL = 0;
      const formattedSells = sells.map((sell: any, index: number) => {
        const sellAmountSOL = (parseFloat(sell.out_amount) || 0) / Math.pow(10, SOL_DECIMALS);
        const sellAmountTokens = (parseFloat(sell.in_amount) || 0) / Math.pow(10, tokenDecimals);
        const sellMarketCap = sell.marketCap ? parseFloat(sell.marketCap) : null;
        // nth Sell PNL = (Wallet Buy Market Cap / nth Sell Market Cap - 1) * 100 (as percentage)
        const firstSellPNL = firstBuyMarketCap && sellMarketCap && sellMarketCap > 0
          ? ((firstBuyMarketCap / sellMarketCap) - 1) * 100
          : null;
        const sellPercentOfBuy = walletBuyAmountTokens > 0
          ? (sellAmountTokens / walletBuyAmountTokens) * 100
          : null;
        
        // Calculate cumulative profit at this sell point
        cumulativeSellAmountSOL += sellAmountSOL;
        const profitAtSell = walletBuyAmountSOL > 0
          ? ((cumulativeSellAmountSOL - walletBuyAmountSOL) / walletBuyAmountSOL) * 100
          : null;
        
        // Calculate holding time (time from buy to this sell)
        let holdingTimeSeconds = null;
        if (buyTimestamp) {
          const sellTimestamp = sell.blockTimestamp || sell.created_at;
          if (sellTimestamp) {
            const buyTime = new Date(buyTimestamp).getTime();
            const sellTime = new Date(sellTimestamp).getTime();
            holdingTimeSeconds = Math.floor((sellTime - buyTime) / 1000);
            if (holdingTimeSeconds < 0) holdingTimeSeconds = null;
          }
        }
        
        return {
          sellNumber: index + 1,
          marketCap: sellMarketCap,
          firstSellPNL: firstSellPNL,
          sellPercentOfBuy: sellPercentOfBuy,
          sellAmountSOL: sellAmountSOL,
          sellAmountTokens: sellAmountTokens,
          transactionSignature: sell.transaction_id,
          timestamp: formatTimestamp(sell.blockTimestamp || sell.created_at),
          profitAtSell: profitAtSell,
          holdingTimeSeconds: holdingTimeSeconds
        };
      });
      
      return {
        // Basic token info
        tokenName: tokenInfo?.token_name || 'Unknown',
        tokenSymbol: tokenInfo?.symbol || '???',
        tokenAddress: token,
        creatorAddress: tokenInfo?.creator || '',
        numberOfSocials: socialCount,
        
        // Dev buy data
        devBuyAmountSOL: devBuyAmountSOL,
        devBuyAmountTokens: devBuyAmountTokens,
        
        // Wallet buy data
        walletBuyAmountSOL: walletBuyAmountSOL,
        walletBuySOLPercentOfDev: walletBuySOLPercentOfDev,
        walletBuyAmountTokens: walletBuyAmountTokens,
        walletBuyTokensPercentOfDev: walletBuyTokensPercentOfDev,
        
        // Supply percentages
        devBuyTokensPercentOfTotalSupply: devBuyTokensPercentOfTotalSupply,
        walletBuyPercentOfTotalSupply: walletBuyPercentOfTotalSupply,
        walletBuyPercentOfRemainingSupply: walletBuyPercentOfRemainingSupply,
        
        // Price data
        tokenPeakPriceBeforeFirstSell: tokenPeakPriceBeforeFirstSell,
        tokenPeakPrice10sAfterFirstSell: tokenPeakPrice10sAfterFirstSell,
        tokenPeakMarketCapBeforeFirstSell: tokenPeakMarketCapBeforeFirstSell,
        tokenPeakMarketCap10sAfterFirstSell: tokenPeakMarketCap10sAfterFirstSell,
        
        // Position data
        walletBuyPositionAfterDev: walletBuyPositionAfterDev,
        walletBuyBlockNumber: firstBuy?.blockNumber || null,
        walletBuyBlockNumberAfterDev: walletBuyBlockNumberAfterDev,
        walletBuyTimestamp: formatTimestamp(firstBuy?.blockTimestamp || firstBuy?.created_at),
        walletBuyMarketCap: firstBuyMarketCap,
        openPositionCount: openPositionCount,
        
        // Gas & fees
        walletGasAndFeesAmount: totalGasAndFees,
        
        // Transaction signature
        transactionSignature: firstBuy?.transaction_id || '',
        
        // PNL
        pnlSOL: pnlSOL,
        pnlPercent: pnlPercent,
        
        // Sells
        sells: formattedSells
      };
    }));
    
    res.json({ success: true, data: dashboardData, totalBuys, totalSells, averageOpenPosition });
  } catch (error: any) {
    console.error('Dashboard data error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/wallet-activity/:wallet - Get trading activity aggregated by time interval
 * Query params: interval (hour, quarter_day, day, week, month)
 */
app.get("/api/wallet-activity/:wallet", requireAuth, async (req, res) => {
  try {
    const { wallet } = req.params;
    const interval = (req.query.interval as string) || 'day';
    
    // Validate interval
    const validIntervals = ['hour', 'quarter_day', 'day', 'week', 'month'];
    if (!validIntervals.includes(interval)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid interval. Must be one of: ${validIntervals.join(', ')}` 
      });
    }
    
    const activity = await dbService.getWalletTradingActivity(
      wallet, 
      interval as 'hour' | 'quarter_day' | 'day' | 'week' | 'month'
    );
    
    res.json({ success: true, data: activity, interval });
  } catch (error: any) {
    console.error('Wallet activity error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dashboard-filter-presets - Get all dashboard filter presets
 */
app.get("/api/dashboard-filter-presets", requireAuth, async (req, res) => {
  try {
    const presets = await dbService.getDashboardFilterPresets();
    res.json({ success: true, presets });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dashboard-filter-presets/:name - Get dashboard filter preset by name
 */
app.get("/api/dashboard-filter-presets/:name", requireAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const preset = await dbService.getDashboardFilterPreset(name);
    if (!preset) {
      return res.status(404).json({ success: false, error: 'Preset not found' });
    }
    res.json({ success: true, preset });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dashboard-filter-presets - Save dashboard filter preset
 */
app.post("/api/dashboard-filter-presets", requireAuth, async (req, res) => {
  try {
    const { name, filters } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Preset name is required' });
    }
    
    await dbService.saveDashboardFilterPreset(name.trim(), filters || {});
    res.json({ success: true, message: 'Filter preset saved successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/dashboard-filter-presets/:name - Delete dashboard filter preset
 */
app.delete("/api/dashboard-filter-presets/:name", requireAuth, async (req, res) => {
  try {
    const { name } = req.params;
    await dbService.deleteDashboardFilterPreset(name);
    res.json({ success: true, message: 'Filter preset deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
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

