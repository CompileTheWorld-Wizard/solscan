# PM2 Setup Guide for Ubuntu

This guide will help you set up and run the Solscan application using PM2 on Ubuntu.

## Prerequisites

1. **Node.js and npm** (v16 or higher)
2. **PostgreSQL** installed and running
3. **PM2** installed globally

## Installation Steps

### 1. Install PM2

```bash
npm install -g pm2
```

### 2. Install Project Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env  # If you have an example file
# OR create manually:
nano .env
```

Required environment variables:
```env
# Yellowstone gRPC
GRPC_URL=your_grpc_url_here
X_TOKEN=your_token_here

# Shyft API
SHYFT_API_KEY=your_shyft_api_key_here

# Solscan API (optional)
SOLSCAN_API_KEY=your_solscan_api_key_here

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=solscan
DB_USER=postgres
DB_PASSWORD=your_password_here

# Solana RPC (optional)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Session Secret (for authentication)
SESSION_SECRET=your-random-secret-key-here

# Server Port (optional, defaults to 3000)
PORT=3000

# Trust Proxy (set to 'true' if behind nginx/reverse proxy)
TRUST_PROXY=true

# Use HTTPS (set to 'true' only if using HTTPS/SSL)
# If false or not set, secure cookies will be disabled even in production
USE_HTTPS=false
```

### 4. Set Up Database

Make sure PostgreSQL is running and the database exists:

```bash
# Create database
sudo -u postgres psql
CREATE DATABASE solscan;
\q
```

The application will automatically create tables and run migrations on first start.

### 5. Create Logs Directory

```bash
mkdir -p logs
```

## Running with PM2

### Option 1: Development Mode (with ts-node)

This runs TypeScript directly without compilation:

```bash
# Start the application
pm2 start ecosystem.config.js

# Or with custom name
pm2 start ecosystem.config.js --name solscan
```

### Option 2: Production Mode (compiled)

For better performance in production:

```bash
# First, build the TypeScript code
npm run build

# Then start with production config
pm2 start ecosystem.config.prod.js
```

## PM2 Commands

### Basic Commands

```bash
# Start the application
pm2 start ecosystem.config.js

# Stop the application
pm2 stop solscan

# Restart the application
pm2 restart solscan

# Reload the application (zero-downtime restart)
pm2 reload solscan

# Delete the application from PM2
pm2 delete solscan

# View application status
pm2 status

# View logs
pm2 logs solscan

# View logs with tail (real-time)
pm2 logs solscan --lines 100

# Monitor resources
pm2 monit

# View detailed information
pm2 show solscan
```

### Log Management

```bash
# View all logs
pm2 logs

# View only error logs
pm2 logs solscan --err

# View only output logs
pm2 logs solscan --out

# Clear logs
pm2 flush

# Log rotation (if using PM2 Plus)
pm2 install pm2-logrotate
```

## Auto-Start on System Boot

To make PM2 start your application automatically on system reboot:

```bash
# Generate startup script
pm2 startup

# Follow the instructions it prints (usually involves running a sudo command)

# Save current PM2 process list
pm2 save
```

After this, your application will automatically start on system boot.

## Update/Deploy New Version

When deploying updates:

```bash
# Pull latest code
git pull

# Install new dependencies (if any)
npm install

# Build (if using production mode)
npm run build

# Restart the application
pm2 restart solscan

# Or reload for zero-downtime
pm2 reload solscan
```

## Troubleshooting

### Application won't start

```bash
# Check PM2 logs
pm2 logs solscan --lines 50

# Check if port is already in use
sudo lsof -i :3000

# Check PostgreSQL connection
psql -h localhost -U postgres -d solscan
```

### Application keeps restarting

```bash
# Check error logs
pm2 logs solscan --err

# Check application status
pm2 show solscan

# Temporarily disable auto-restart to debug
pm2 stop solscan
node src/server.ts  # Run manually to see errors
```

### View Environment Variables

```bash
# Check what PM2 sees
pm2 show solscan

# Or inspect environment
pm2 env 0  # Replace 0 with your app ID
```

### Database Connection Issues

```bash
# Test PostgreSQL connection
psql -h localhost -U postgres -d solscan

# Check PostgreSQL is running
sudo systemctl status postgresql

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

## Performance Monitoring

```bash
# Real-time monitoring
pm2 monit

# View process information
pm2 show solscan

# View memory usage
pm2 list
```

## Additional PM2 Plugins

```bash
# Install log rotation
pm2 install pm2-logrotate

# Configure log rotation (optional)
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

## Security Notes

1. **Never commit `.env` file** to version control
2. **Use strong `SESSION_SECRET`** for production
3. **Set up firewall** rules for your server
4. **Use HTTPS** in production (set up reverse proxy with nginx)
5. **Regularly update** dependencies: `npm audit fix`

## Reverse Proxy Setup (Optional)

For production, you might want to use nginx as a reverse proxy:

```nginx
# /etc/nginx/sites-available/solscan
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then enable it:
```bash
sudo ln -s /etc/nginx/sites-available/solscan /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Useful Links

- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [PM2 GitHub](https://github.com/Unitech/pm2)

