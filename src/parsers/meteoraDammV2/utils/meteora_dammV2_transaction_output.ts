export function meteoradammV2TransactionOutput(parsedInstruction, txn) {
  let output = {};
  let SOL = "So11111111111111111111111111111111111111112"
  const swapInstruction = parsedInstruction.instructions.find(
    (instruction) => instruction.name === 'swap'
  );
  if (!swapInstruction) return;
  const input_amount = swapInstruction.args.params.amount_in;
  const pool_authority = swapInstruction.accounts.find(a => a.name == "pool_authority").pubkey;
  const mint_a = swapInstruction.accounts.find(a => a.name === "token_a_mint").pubkey;
  const mint_b = swapInstruction.accounts.find(a => a.name === "token_b_mint").pubkey;
  const payer = swapInstruction.accounts.find(a => a.name === "payer").pubkey;
  const preTokenBalances = txn.meta.preTokenBalances.find(a => a.owner === pool_authority && a.mint != SOL)?.uiTokenAmount?.uiAmount;
  const postTokenBalance = txn.meta.postTokenBalances.find(a => a.owner === pool_authority && a.mint != SOL)?.uiTokenAmount?.uiAmount;
  const buy_sell_determiner = preTokenBalances > postTokenBalance ? "Buy" : "Sell";


  const outputTransfer = parsedInstruction.inner_ixs.find(
    (ix) =>
      ix.name === "transferChecked" &&
      ix.args.amount != input_amount
  );

  const { inner_ixs, instructions } = parsedInstruction;
  const events = inner_ixs?.events || [];
  const innerSwapIxns = inner_ixs?.meteroa_damm_inner_ixs || [];
  if (!events.length || !innerSwapIxns.length) return;
  const transferCheck = innerSwapIxns.filter(ix => ix.name === 'transferChecked');
  const transfers = transferCheck.map(ix => {
    const mint = ix.accounts.find(acc => acc.name === 'mint')?.pubkey;
    const source = ix.accounts.find(acc => acc.name === 'source')?.pubkey;
    const destination = ix.accounts.find(acc => acc.name === 'destination')?.pubkey;
    const decimal = ix.args.decimals;

    return { mint, source, destination, decimal };
  });
  const swapTxn = innerSwapIxns.find(ix => ix.name === 'swap');
  const baseMint = swapTxn.accounts.find(acc => acc.name === 'token_a_mint')?.pubkey;
  const quoteMint = swapTxn.accounts.find(acc => acc.name === 'token_b_mint')?.pubkey;
  const baseDecimal = transfers.find(acc => acc.mint === baseMint)?.decimal;
  const quoteDecimal = transfers.find(acc => acc.mint === quoteMint)?.decimal;

  const swapEvent = events[0].data;
  const sqrtPrice = swapEvent.nextSqrtPrice;
  const calculatePrice = sqrtPriceX64ToPrice(sqrtPrice, baseDecimal, quoteDecimal);

  const event_type = {
    type: buy_sell_determiner,
    user: payer,
    mint_a: mint_a,
    mint_b: mint_b,
    amount_in: input_amount,
    amount_out: outputTransfer.args.amount
  };

  return event_type;
}

function sqrtPriceX64ToPrice(nextSqrtPriceStr: string, decimalsA: number, decimalsB: number) {
  const sqrtPriceX64 = BigInt(nextSqrtPriceStr);
  const sqrtPrice = Number(sqrtPriceX64) / 2 ** 64;
  let price = sqrtPrice * sqrtPrice;
  const decimalAdjustment = 10 ** (decimalsA - decimalsB);
  price = price * decimalAdjustment;
  return price;
}
