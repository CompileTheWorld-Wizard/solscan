/**
 * PM2 Ecosystem Configuration (Production - Compiled)
 * 
 * This version compiles TypeScript first, then runs the compiled JS.
 * Recommended for production for better performance.
 * 
 * Usage:
 *   npm run build                           # Build TypeScript first
 *   pm2 start ecosystem.config.prod.js     # Start the app
 */

module.exports = {
  apps: [
    {
      name: 'solscan-prod',
      script: './dist/src/server.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    }
  ]
};

