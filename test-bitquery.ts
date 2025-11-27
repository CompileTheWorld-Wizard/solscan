require("dotenv").config();
import { bitqueryService } from './src/services/bitqueryService';

/**
 * Test script for Bitquery Service
 * Tests the ATH market cap functionality
 */

// Default test tokens from the user's example
const DEFAULT_TEST_TOKENS = [
  "639g7XEn1fMf7ZpHhKWUiHywY4PpQ5QPm6VMsw8Cpump",
  "FXMCWau8etMkKZnyn4pi9qMM3NVfrCHFM4KKnJvNpump"
];

// Default since date from the user's example
const DEFAULT_SINCE_DATE = "2025-05-03T06:37:00Z";

class BitqueryTester {
  private testTokens: string[] = [];
  private sinceDate?: string;

  constructor() {
    this.testTokens = [...DEFAULT_TEST_TOKENS];
  }

  /**
   * Set test tokens
   */
  setTestTokens(tokens: string[]) {
    this.testTokens = tokens.filter(addr => addr.trim().length > 0);
    console.log('\n' + '='.repeat(80));
    console.log('📍 TEST TOKENS:');
    console.log('='.repeat(80));
    this.testTokens.forEach((token, index) => {
      console.log(`   ${index + 1}. ${token}`);
    });
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Set since date
   */
  setSinceDate(date: string) {
    this.sinceDate = date;
    console.log(`📅 Using since date: ${this.sinceDate}\n`);
  }

  /**
   * Format number with commas
   */
  private formatNumber(num: number): string {
    if (num === 0) return '0';
    if (num < 0.01) return num.toExponential(2);
    return num.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  }

  /**
   * Format market cap
   */
  private formatMarketCap(mcap: number): string {
    if (mcap === 0) return '$0';
    if (mcap >= 1e9) return `$${(mcap / 1e9).toFixed(2)}B`;
    if (mcap >= 1e6) return `$${(mcap / 1e6).toFixed(2)}M`;
    if (mcap >= 1e3) return `$${(mcap / 1e3).toFixed(2)}K`;
    return `$${this.formatNumber(mcap)}`;
  }

  /**
   * Display results
   */
  private displayResults(results: any[], title: string) {
    console.log('\n' + '='.repeat(80));
    console.log(`📊 ${title}`);
    console.log('='.repeat(80));

    if (results.length === 0) {
      console.log('⚠️  No results found');
      console.log('='.repeat(80) + '\n');
      return;
    }

    results.forEach((result, index) => {
      console.log(`\n${index + 1}. Token: ${result.symbol || 'N/A'} (${result.name || 'N/A'})`);
      console.log(`   Mint Address: ${result.mintAddress}`);
      console.log(`   ATH Price (USD): $${this.formatNumber(result.athPriceUSD)}`);
      console.log(`   ATH Market Cap: ${this.formatMarketCap(result.athMarketCap)}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log(`✅ Total results: ${results.length}`);
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Test getATHMarketCap for multiple tokens
   */
  async testMultipleTokens(): Promise<void> {
    console.log('🚀 '.repeat(30));
    console.log('TEST 1: Get ATH Market Cap for Multiple Tokens');
    console.log('🚀 '.repeat(30));

    try {
      const startTime = Date.now();
      console.log(`\n⏳ Fetching ATH market cap for ${this.testTokens.length} token(s)...`);
      
      const results = await this.sinceDate 
        ? await bitqueryService.getATHMarketCap(this.testTokens, this.sinceDate)
        : await bitqueryService.getATHMarketCap(this.testTokens);

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      this.displayResults(results, `RESULTS (took ${duration}s)`);

      // Display raw JSON for debugging
      console.log('📄 Raw JSON Response:');
      console.log(JSON.stringify(results, null, 2));
      console.log('');

    } catch (error: any) {
      console.error('\n❌ Error testing multiple tokens:');
      console.error('='.repeat(80));
      console.error(`Message: ${error.message}`);
      if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
      } else {
        console.error(`Stack: ${error.stack}`);
      }
      console.error('='.repeat(80) + '\n');
      throw error;
    }
  }

  /**
   * Test getATHMarketCapForToken for a single token
   */
  async testSingleToken(): Promise<void> {
    if (this.testTokens.length === 0) {
      console.log('⚠️  No tokens to test');
      return;
    }

    const testToken = this.testTokens[0];
    console.log('🚀 '.repeat(30));
    console.log('TEST 2: Get ATH Market Cap for Single Token');
    console.log(`Token: ${testToken}`);
    console.log('🚀 '.repeat(30));

    try {
      const startTime = Date.now();
      console.log(`\n⏳ Fetching ATH market cap for single token...`);
      
      const result = this.sinceDate
        ? await bitqueryService.getATHMarketCapForToken(testToken, this.sinceDate)
        : await bitqueryService.getATHMarketCapForToken(testToken);

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      if (result) {
        this.displayResults([result], `RESULT (took ${duration}s)`);
      } else {
        console.log('\n⚠️  No result found for this token');
        console.log('');
      }

    } catch (error: any) {
      console.error('\n❌ Error testing single token:');
      console.error('='.repeat(80));
      console.error(`Message: ${error.message}`);
      if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
      } else {
        console.error(`Stack: ${error.stack}`);
      }
      console.error('='.repeat(80) + '\n');
      throw error;
    }
  }

  /**
   * Test error handling (missing API key)
   */
  async testErrorHandling(): Promise<void> {
    console.log('🚀 '.repeat(30));
    console.log('TEST 3: Error Handling (Empty Token List)');
    console.log('🚀 '.repeat(30));

    try {
      const results = await bitqueryService.getATHMarketCap([]);
      console.log(`\n✅ Empty token list handled correctly. Returned ${results.length} results.\n`);
    } catch (error: any) {
      console.error('\n❌ Unexpected error with empty token list:');
      console.error(`Message: ${error.message}\n`);
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('\n' + '🔍 '.repeat(30));
    console.log('BITQUERY SERVICE TEST SUITE');
    console.log('🔍 '.repeat(30));
    console.log(`\n📋 Configuration:`);
    console.log(`   API Key: ${process.env.BITQUERY_API_KEY ? '✅ Set' : '❌ Not set'}`);
    console.log(`   Test Tokens: ${this.testTokens.length}`);
    console.log(`   Since Date: ${this.sinceDate || 'Not specified (will use default)'}`);
    console.log('');

    try {
      // Test 1: Multiple tokens
      await this.testMultipleTokens();

      // Test 2: Single token
      await this.testSingleToken();

      // Test 3: Error handling
      await this.testErrorHandling();

      console.log('\n' + '✅ '.repeat(30));
      console.log('ALL TESTS COMPLETED');
      console.log('✅ '.repeat(30) + '\n');

    } catch (error: any) {
      console.error('\n' + '❌ '.repeat(30));
      console.error('TESTS FAILED');
      console.error('❌ '.repeat(30));
      console.error(`\nError: ${error.message}\n`);
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const tester = new BitqueryTester();

  // Parse command line arguments
  const args = process.argv.slice(2);
  
  // Check for --date flag
  const dateIndex = args.indexOf('--date');
  if (dateIndex !== -1 && args[dateIndex + 1]) {
    tester.setSinceDate(args[dateIndex + 1]);
    args.splice(dateIndex, 2); // Remove --date and its value
  }

  // Remaining args are token addresses
  if (args.length > 0) {
    tester.setTestTokens(args);
  } else {
    tester.setTestTokens(DEFAULT_TEST_TOKENS);
  }

  // Check if API key is set
  if (!process.env.BITQUERY_API_KEY) {
    console.error('\n❌ Error: BITQUERY_API_KEY not set in environment variables');
    console.error('Please add BITQUERY_API_KEY to your .env file\n');
    process.exit(1);
  }

  // Run tests
  await tester.runAllTests();
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { BitqueryTester };

