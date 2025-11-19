function calculatePumpAmmPrice(
    pool_base_reserve: number,
    pool_quote_reserve: number,
    decimal: number
): number {

    const base = pool_base_reserve / 1_000_000_000;;
    const quote = pool_quote_reserve / Math.pow(10, decimal);
    return base / quote;
}

export function parseSwapTransactionOutput(parsedInstruction, transaction) {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const { inner_ixs, instructions } = parsedInstruction;

    if (!parsedInstruction || !transaction?.meta) {
        return;
    }

    let swapInstruction =
        parsedInstruction?.instructions?.pumpAmmIxs?.find(
            instruction => instruction.name === 'buy' || instruction.name === 'sell'
        ) ||
        parsedInstruction?.inner_ixs?.find(
            instruction => instruction.name === 'buy' || instruction.name === 'sell'
        ) ||
        parsedInstruction?.inner_ixs?.pump_amm_inner_ixs?.find(
            instruction => instruction.name === 'buy' || instruction.name === 'sell'
        );

    if (!swapInstruction) {
        return;
    }
    const isSell = swapInstruction.name === 'sell';
    const isBuy = swapInstruction.name === 'buy';

    const evt = parsedInstruction?.instructions?.events?.[0]?.data ?? {};
    const {
        base_amount_in,
        quote_amount_out,
        user_base_token_reserves,
        user_quote_token_reserves,
        pool_base_token_reserves,
        pool_quote_token_reserves,
        coin_creator,
    } = evt;

    const signerPubkey = swapInstruction?.accounts.find((account) => account.name === 'user')?.pubkey ?? coin_creator;

    const swapAmount = isSell
        ? swapInstruction.args?.base_amount_in
        : swapInstruction.args?.base_amount_out;

    const quoteAmount = isSell
        ? swapInstruction.args?.min_quote_amount_out
        : swapInstruction.args?.max_quote_amount_in;

    function determineOutAmount() {
        if (!transaction?.meta?.innerInstructions) return null;

        const transferCheckedIx = parsedInstruction.inner_ixs?.find(ix =>
            ix.name === 'transferChecked' && ix.args?.amount !== swapAmount
        );

        return transferCheckedIx?.args?.amount ?? null;
    }

    function determineBuySellEvent() {
        const baseMint = swapInstruction.accounts?.find(a => a.name === 'base_mint')?.pubkey;
        const quoteMint = swapInstruction.accounts?.find(a => a.name === 'quote_mint')?.pubkey;

        if (!baseMint || !quoteMint) {
            return { type: "Unknown", mint: null };
        }

        const mint = baseMint === SOL_MINT ? quoteMint : baseMint;
        return { type: isBuy ? "Buy" : "Sell", mint };
    }

    const buySellEvent = determineBuySellEvent();
    const computedOut = determineOutAmount();

    const amountIn = isBuy ? computedOut : swapInstruction.args?.base_amount_in;
    const amountOut = isSell ? computedOut : swapInstruction.args?.base_amount_out;

    const alternativeMint = transaction.meta.preTokenBalances?.find(x => x.mint !== SOL_MINT)?.mint;

    // Calculate the price
    let baseMintPubkey = swapInstruction.accounts.find((account) => account.name === 'base_mint')?.pubkey;
    let quoteMintPubkey = swapInstruction.accounts.find((account) => account.name === 'quote_mint')?.pubkey;

    function getValidMints(baseMint: string, quoteMint: string, preTokenBalances: any[]): [string, string] {
        const invalidPattern = /=|[^A-Za-z0-9]/g;

        const isValid = (mint: string) => mint && !invalidPattern.test(mint);
        if (isValid(baseMint) && isValid(quoteMint)) {
            return [baseMint, quoteMint];
        }
        const uniqueMints = [...new Set(preTokenBalances.map((b) => b.mint))];

        if (!isValid(baseMint)) {
            const replacement = uniqueMints.find((m) => m !== quoteMint);
            if (replacement) baseMint = replacement;
        }

        if (!isValid(quoteMint)) {
            const replacement = uniqueMints.find((m) => m !== baseMint);
            if (replacement) quoteMint = replacement;
        }

        return [baseMint, quoteMint];
    }

    [baseMintPubkey, quoteMintPubkey] = getValidMints(
        baseMintPubkey,
        quoteMintPubkey,
        transaction?.meta?.preTokenBalances || [],
    );

    let mint = null;
    if (baseMintPubkey && quoteMintPubkey) {
        mint = baseMintPubkey === SOL_MINT ? quoteMintPubkey : baseMintPubkey;
    }

    const decimal = transaction?.meta?.preTokenBalances?.find(
        (b) => b.mint === quoteMintPubkey || b.mint === baseMintPubkey
    )?.uiTokenAmount?.decimals || 9;

    let price;
    if (baseMintPubkey === SOL_MINT) {
        price = calculatePumpAmmPrice(pool_base_token_reserves, pool_quote_token_reserves, decimal);
    } else {
        price = calculatePumpAmmPrice(pool_quote_token_reserves, pool_base_token_reserves, decimal);
    }

    const formattedPrice = price.toFixed(20).replace(/0+$/, '');
    const pool = swapInstruction.accounts?.find(a => a.name === 'pool')?.pubkey;

    const transactionEvent = {
        price: formattedPrice,
        type: swapInstruction.name,
        user: signerPubkey,
        mint: buySellEvent.mint ?? alternativeMint,
        out_amount: amountOut ?? quote_amount_out,
        in_amount: amountIn ?? base_amount_in,
        pool
    };

    return transactionEvent;
}