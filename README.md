# Solscan - Solana Transaction Tracker

A real-time Solana transaction tracker with a web interface for monitoring DEX transactions across multiple platforms.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file:

```env
# Yellowstone gRPC
GRPC_URL=your_grpc_url_here
X_TOKEN=your_token_here

# Shyft API (for wallet analysis and transaction parsing)
SHYFT_API_KEY=your_shyft_api_key_here

# Helius API (for token creator info)
HELIUS_API_KEY=your_helius_api_key_here

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=solscan
DB_USER=postgres
DB_PASSWORD=your_password_here

# Solana RPC (optional, defaults to mainnet)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

### 3. Setup Database

**Create PostgreSQL database:**

```bash
psql -U postgres
CREATE DATABASE solscan;
```

The application automatically creates tables on first run.

### 4. Start the Application

```bash
npm start
```

Open your browser: **http://localhost:3000**

## 📖 How to Use

1. **Enter Addresses** - Add up to 5 Solana addresses you want to track
2. **Click "Start Tracking"** - Begin monitoring transactions
3. **View Results** - Real-time transactions appear in the table
4. **Filter by Date** - Use date filters to view specific time periods
5. **Click "Stop Tracking"** - Pause monitoring when done

## ✨ Features

- ✅ **Web Interface** - Control everything from your browser
- ✅ **Real-time Tracking** - Live transaction monitoring
- ✅ **Date Filtering** - View transactions by date range
- ✅ **Multiple DEX Support** - Raydium, Orca, Meteora, Pump.fun, and more
- ✅ **PostgreSQL Storage** - All transactions saved to database
- ✅ **Auto-refresh** - Updates every 3 seconds
- ✅ **Pagination** - Browse through transaction history
- ✅ **Start/Stop Controls** - Full control over tracking
- ✅ **Wallet Analysis** - Analyze any wallet's SOL balance and token holdings
- ✅ **Token Creator Info** - Fetch and cache token creator and first buy (dev buy) amount
- ✅ **Smart Caching** - Only fetch uncached tokens to save API quota

## 🎯 Supported Platforms

- **Raydium** (AMM, CLMM, CPMM, LaunchPad)
- **Orca** (Whirlpool)
- **Meteora** (DLMM, DBC, DAMM V2)
- **Pump.fun**
- **Pump AMM**

## 📁 Project Structure

```
solscan/
├── src/
│   ├── server.ts           # Web server
│   ├── index.ts            # CLI version (optional)
│   ├── tracker/            # Transaction tracking service
│   ├── database/           # PostgreSQL integration
│   └── parsers/            # DEX-specific parsers
├── public/
│   └── index.html          # Web interface
└── .env                    # Configuration
```

## 🔧 Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Start web interface (recommended) |
| `npm run server` | Same as npm start |
| `npm run start-cli` | Command-line version |
| `npm run build` | Build TypeScript |

## 💡 Usage Tips

### Testing with Popular DEX Addresses

```
Raydium V4:  675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8
Orca:        whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
Meteora:     LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo
Pump.fun:    6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
```

### Date Filtering

- **Specific Date Range** - Select both From and To dates
- **From Date Onwards** - Select only From date
- **Up to Date** - Select only To date
- **Clear Filter** - Click "Clear Filter" button

### Database Queries

```sql
-- View all transactions
SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;

-- Filter by platform
SELECT * FROM transactions WHERE platform = 'PumpFun';

-- Filter by wallet
SELECT * FROM transactions WHERE fee_payer = 'YOUR_WALLET';

-- Count by platform
SELECT platform, COUNT(*) FROM transactions GROUP BY platform;
```

## 🔍 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Get tracker status |
| `/api/addresses` | POST | Set addresses to track |
| `/api/start` | POST | Start tracking |
| `/api/stop` | POST | Stop tracking |
| `/api/transactions` | GET | Get transactions (with date filters) |

## 🐛 Troubleshooting

### Server Won't Start

- Check `.env` file exists with valid credentials
- Ensure PostgreSQL is running
- Verify port 3000 is available

### No Transactions Appearing

- Verify addresses are correct Solana addresses
- Check addresses are active on the network
- Look for errors in server console

### Database Connection Failed

```bash
# Start PostgreSQL
# Windows
Get-Service postgresql*

# Linux/Mac
sudo systemctl start postgresql
```

### Wrong Command

**Use `npm start` for web interface** (not `npm run start-cli`)

## 🗄️ Database Schema

**Table: transactions**

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Auto-increment ID |
| transaction_id | VARCHAR(100) | Solana signature (unique) |
| platform | VARCHAR(50) | DEX platform name |
| type | VARCHAR(20) | buy/sell |
| mint_from | VARCHAR(100) | Source token mint |
| mint_to | VARCHAR(100) | Destination token mint |
| in_amount | NUMERIC(40, 0) | Input amount |
| out_amount | NUMERIC(40, 0) | Output amount |
| fee_payer | VARCHAR(100) | Wallet address |
| created_at | TIMESTAMP | Record timestamp |

## 📊 How It Works

```
Browser → Express Server → Tracker Service → Yellowstone gRPC
   ↓                              ↓
Database ←─────────────────────────┘
```

1. Enter addresses in web interface
2. Tracker subscribes to Yellowstone gRPC
3. Real-time transactions are parsed
4. Data saved to PostgreSQL
5. Web interface displays results

## 🔐 Security Notes

**For Production:**
- Add authentication
- Enable HTTPS
- Restrict CORS origins
- Use environment variables for secrets
- Implement rate limiting

## 📦 Dependencies

- `@triton-one/yellowstone-grpc` - Solana gRPC streaming
- `@solana/web3.js` - Solana JavaScript API
- `@project-serum/anchor` - Anchor framework
- `express` - Web server
- `pg` - PostgreSQL client
- `dotenv` - Environment variables

## 🎓 Understanding the System

### Web Interface (Recommended)

1. Run `npm start`
2. Server waits for your input
3. Enter addresses in browser
4. Click "Start" to begin tracking
5. Click "Stop" to pause
6. Full control from browser

### CLI Version (Alternative)

1. Run `npm run start-cli`
2. Immediately starts tracking
3. Uses hardcoded addresses in `src/index.ts`
4. No web interface
5. Stop with Ctrl+C

## 🤝 Contributing

Feel free to fork, modify, and submit pull requests!

## 📄 License

MIT

---

**Ready to track? Run `npm start` and open http://localhost:3000** 🚀
