export function raydiumCPFormatter(parsedInstruction, txn) {
  const instructions = parsedInstruction.instructions || parsedInstruction.raydiumCPIxs;
  const innerInstructions = parsedInstruction.inner_ixs || parsedInstruction.innerIx || parsedInstruction.innerInstructions;
  const preTB = txn.meta.postTokenBalances[0].owner
  const ev = parsedInstruction.events;
  const events =
    (Array.isArray(ev) ? ev[0]?.data || ev[0] : ev) || {};
  const SOL_MINT = "So11111111111111111111111111111111111111112"

  const swapInstruction =
    parsedInstruction.swapInstruction ||
    instructions?.find(
      (x) => x.name === "swap_base_input" || x.name === "swap_base_output"
    ) ||
    innerInstructions?.find(
      (x) => x.name === "swap_base_input" || x.name === "swap_base_output"
    ) ||
    undefined;
  const inputAmount = events.inputAmount ?? events.input_amount;
  const outputAmount = events.outputAmount ?? events.output_amount;
  const inputToken = events.inputMint ?? events.input_mint;
  const outputToken = events.outputMint ?? events.output_mint;
  const inputVault = events.inputVaultBefore ?? events.input_vault_before;
  const outputVault = events.outputVaultBefore ?? events.output_vault_before;

  if (!inputAmount) return undefined;

  const payer =
    swapInstruction?.accounts?.find((x) => x.name === "payer")?.pubkey ?? preTB;

  const martDeterminer = (mint: string) => mint === SOL_MINT;
  const type = (e => e ? "Buy" : "Sell")(martDeterminer(inputToken))

  // Calculate the price
  const preTBs = txn.meta?.postTokenBalances;

  const inputDecimals = preTBs.find((x) => x.mint === inputToken)?.uiTokenAmount?.decimals;
  const outputDecimals = preTBs.find((x) => x.mint === outputToken)?.uiTokenAmount?.decimals;

  const rawPrice =
    Number(inputVault) > 0
      ? Number(outputVault) / Number(inputVault)
      : undefined;

  let adjustedPrice: number | undefined;

  if (martDeterminer(inputToken)) {
    adjustedPrice =
      Number(outputVault) > 0
        ? (Number(inputVault) / 10 ** inputDecimals) /
        (Number(outputVault) / 10 ** outputDecimals)
        : undefined;
  } else {
    adjustedPrice =
      Number(inputVault) > 0
        ? (Number(outputVault) / 10 ** outputDecimals) /
        (Number(inputVault) / 10 ** inputDecimals)
        : undefined;
  }
  return {
    type: type,
    payer: payer,
    inputToken: inputToken,
    outputToken: outputToken,
    inAmount: inputAmount,
    outAmount: outputAmount,
    price: adjustedPrice?.toFixed(17),
  };
}