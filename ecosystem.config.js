/**
 * PM2 Ecosystem Configuration
 * 
 * Usage:
 *   pm2 start ecosystem.config.js          # Start the app
 *   pm2 stop solscan                       # Stop the app
 *   pm2 restart solscan                    # Restart the app
 *   pm2 logs solscan                       # View logs
 *   pm2 monit                              # Monitor
 *   pm2 save                               # Save current process list
 *   pm2 startup                            # Generate startup script
 */

module.exports = {
  apps: [
    {
      name: 'solscan',
      script: 'node_modules/.bin/ts-node',
      args: 'src/server.ts',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        TS_NODE_PROJECT: './tsconfig.json'
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
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000
    }
  ]
};

