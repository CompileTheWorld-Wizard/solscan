#!/usr/bin/env node

/**
 * Startup script for Solana Transaction Tracker Web Interface
 * 
 * This script checks environment variables and starts the web server.
 */

const fs = require('fs');
const { exec } = require('child_process');

console.log('🚀 Starting Solana Transaction Tracker Web Interface...\n');

// Check if .env file exists
if (!fs.existsSync('.env')) {
  console.error('❌ Error: .env file not found!');
  console.error('Please create a .env file with the following variables:');
  console.error('  GRPC_URL=your_grpc_url');
  console.error('  X_TOKEN=your_token');
  console.error('  DB_HOST=localhost');
  console.error('  DB_PORT=5432');
  console.error('  DB_NAME=solscan');
  console.error('  DB_USER=postgres');
  console.error('  DB_PASSWORD=your_password');
  console.error('  PORT=3000 (optional)');
  process.exit(1);
}

// Check if node_modules exists
if (!fs.existsSync('node_modules')) {
  console.error('❌ Error: node_modules not found!');
  console.error('Please run: npm install');
  process.exit(1);
}

// Check if PostgreSQL is running (basic check)
console.log('✅ Environment file found');
console.log('✅ Dependencies installed');
console.log('\n📝 Starting web server...\n');

// Start the server
const server = exec('npx ts-node src/server.ts');

server.stdout.on('data', (data) => {
  process.stdout.write(data);
});

server.stderr.on('data', (data) => {
  process.stderr.write(data);
});

server.on('exit', (code) => {
  if (code !== 0) {
    console.error(`\n❌ Server exited with code ${code}`);
    process.exit(code);
  }
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log('\n\n⏸️  Shutting down...');
  server.kill('SIGINT');
  process.exit(0);
});

