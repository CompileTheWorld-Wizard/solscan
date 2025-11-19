export function parsedTransactionOutput(parsedInstruction, transaction) {
  const swapInstruction = parsedInstruction.instructions.find((instruction) =>
    instruction.name === 'swap_v2' || instruction.name === 'swap');
  const preTB = transaction.meta.preTokenBalances;
  const swapEvent = parsedInstruction.events[0]?.data;

  if (!swapInstruction) {
    return;
  }

  const token_A = swapInstruction.accounts.find((ix) => ix.name === 'output_vault_mint')?.pubkey;
  const token_B = swapInstruction.accounts.find((ix) => ix.name === 'input_vault_mint')?.pubkey;
  const payer = swapInstruction.accounts.find((ix) => ix.name === 'payer')?.pubkey;
  const swap_type = swapEvent.zero_for_one ? "Buy" : "Sell";
  const amount_A = swap_type === "Buy" ? swapEvent.amount_0 : swapEvent.amount_1;
  const amount_B = swap_type === "Sell" ? swapEvent.amount_0 : swapEvent.amount_1;

  const SOL_MINT = "So11111111111111111111111111111111111111112";

  const isBaseSOL = token_A === SOL_MINT;

  let baseDecimals = preTB.find(acc => acc.mint === token_A)?.uiTokenAmount?.decimals;
  let quoteDecimals = preTB.find(acc => acc.mint === token_B)?.uiTokenAmount?.decimals;

  let invert = false;

  if (isBaseSOL) {
    [baseDecimals, quoteDecimals] = [quoteDecimals, baseDecimals];
    invert = true;
  }

  const sqrtPrice = swapEvent.sqrt_price_x64 ?? swapInstruction.args?.sqrtPriceLimitX64;

  if (!sqrtPrice || baseDecimals === undefined || quoteDecimals === undefined) {
    return undefined
  }
  const calculatePrice = sqrtPriceX64ToPrice(sqrtPrice, baseDecimals, quoteDecimals, true);
  const priceFormated = formatPrice(calculatePrice)

  const transactionEvent = {
    type: swap_type,
    user: payer,
    mint_A: token_A,
    mint_B: token_B,
    amount_in: amount_A,
    amount_out: amount_B,
    price: priceFormated
  };

  return transactionEvent;
}

function sqrtPriceX64ToPrice(
  sqrtPriceX64Str: string,
  baseDecimals: number,
  quoteDecimals: number,
  invert = false
): number {
  const Q64 = BigInt(2) ** BigInt(64);
  const sqrtPriceX64 = BigInt(sqrtPriceX64Str);

  const squared = sqrtPriceX64 * sqrtPriceX64;
  const denominator = Q64 * Q64;

  let price = Number(squared) / Number(denominator);

  const decimalAdjustment = Math.pow(10, quoteDecimals - baseDecimals);
  price *= decimalAdjustment;

  return invert ? 1 / price : price;
}
function formatPrice(price: number, decimals = 20): string {
  let fixed = price.toFixed(decimals);

  fixed = fixed.replace(/\.?0+$/, '');

  return fixed;
}