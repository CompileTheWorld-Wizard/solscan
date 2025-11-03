const { Connection, PublicKey } = require('@solana/web3.js');

async function checkTokenSupply(mintAddress) {
  // Replace with your RPC endpoint
  const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=fbcf4553-f7c1-4fa8-b33d-36540cfc9676');
  const mintPublicKey = new PublicKey(mintAddress);

  try {
    const tokenSupply = await connection.getTokenSupply(mintPublicKey);
    console.log(`Token Supply for Mint ${mintAddress}:`);
    console.log(`  UI Amount: ${tokenSupply.value.uiAmountString}`);
    console.log(`  Raw Amount: ${tokenSupply.value.amount}`);
    console.log(`  Decimals: ${tokenSupply.value.decimals}`);
    // For full details:
    // console.log(JSON.stringify(tokenSupply, null, 2));
  } catch (error) {
    console.error(`Error fetching token supply for mint ${mintAddress}:`, error);
  }
}

// Replace with the actual token mint public key you want to query
const exampleTokenMint = 'F9JSH6iHhSv7yYkKndfhHw6Zt4QNALHGMmbq1z1Tybu2'; // USDC mint
checkTokenSupply(exampleTokenMint);

// Example with a different mint (e.g., Raydium)
// const raydiumMint = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
// checkTokenSupply(raydiumMint);