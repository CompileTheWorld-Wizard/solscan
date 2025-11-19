function calculatePumpAmmPrice(
    pool_base_reserve: number,
    pool_quote_reserve: number,
    decimal : number
): number {

    const base = pool_base_reserve/ 1_000_000_000;;
    const quote = pool_quote_reserve/ Math.pow(10, decimal);
    return base / quote;
}

export function parseSwapTransactionOutput(parsedInstruction, transaction) {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const { inner_ixs, instructions } = parsedInstruction;

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

    const signerPubkey = swapInstruction?.accounts.find((account) => account.name === 'user')?.pubkey;

    const swapAmount = swapInstruction.name === 'sell'
        ? swapInstruction.args?.base_amount_in
        : swapInstruction.args?.base_amount_out;

    const quoteAmount = swapInstruction.name === 'sell'
        ? swapInstruction.args?.min_quote_amount_out
        : swapInstruction.args?.max_quote_amount_in;

    const determineOutAmount = () => {
        if (!transaction.meta.innerInstructions) {
            console.error("No inner instructions found in transaction");
            return null;
        }
        const transferChecked = parsedInstruction.inner_ixs.find(
            (instruction) =>
                instruction.name === 'transferChecked' && instruction.args?.amount !== swapAmount).args?.amount;
        return transferChecked;
    };
    
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

    const parsedEvent = instructions?.events?.find(e => e.name === 'BuyEvent' || e.name === 'SellEvent').data;
    const pool_base_token_reserves = parsedEvent?.pool_base_token_reserves;
    const pool_quote_token_reserves = parsedEvent?.pool_quote_token_reserves;

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

    const base_amount_in = swapInstruction.name === 'sell'
        ? swapInstruction.args?.base_amount_in
        : swapInstruction.args?.base_amount_out;

    const amountIn = swapInstruction.name === 'buy'
        ? determineOutAmount()
        : base_amount_in;

    const amountOut = swapInstruction.name === 'sell'
        ? determineOutAmount()
        : base_amount_in;

    const transactionEvent = {
        type: swapInstruction.name,
        user: signerPubkey,
        mint: mint,
        out_amount: amountOut,
        in_amount: amountIn,
        price: formattedPrice
    };

    return transactionEvent;
}