import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import { SolanaParser } from "shyft-parser-v2";
import { Idl } from "@coral-xyz/anchor";
import { TransactionFormatter } from "./utils/transaction-formatter";
import { SolanaEventParser } from "./utils/event-parser";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";
import raydiumClmmIdl from "./idls/raydium_clmm..json";
import { parsedTransactionOutput } from "./utils/parsedTransactionOutput";

const TXN_FORMATTER = new TransactionFormatter();

const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey(
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
);
const TOKEN_PROGRAM_ID = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const RAYDIUM_CLMM_IX_PARSER = new SolanaParser([]);
RAYDIUM_CLMM_IX_PARSER.addParserFromIdl(
    RAYDIUM_CLMM_PROGRAM_ID.toBase58(),
    raydiumClmmIdl as Idl
);
const RAYDIUM_CLMM_EVENT_PARSER = new SolanaEventParser([], console);
RAYDIUM_CLMM_EVENT_PARSER.addParserFromIdl(
    RAYDIUM_CLMM_PROGRAM_ID.toBase58(),
    raydiumClmmIdl as Idl
);

function decodeRaydiumClmmTxn(tx: VersionedTransactionResponse) {
    if (tx.meta?.err) return;
    const hydratedTx = hydrateLoadedAddresses(tx);

    const paredIxs = RAYDIUM_CLMM_IX_PARSER.parseTransactionData(
        hydratedTx.transaction.message,
        hydratedTx.meta.loadedAddresses
    );
    const raydiumClmmIxs = paredIxs.filter((ix) =>
        ix.programId.equals(RAYDIUM_CLMM_PROGRAM_ID) ||
        ix.programId.equals(TOKEN_PROGRAM_ID)
    );
    const parsedInnerIxs = RAYDIUM_CLMM_IX_PARSER.parseTransactionWithInnerInstructions(hydratedTx);

    let raydium_clmm_inner_ixs = parsedInnerIxs.filter((ix) =>
        ix.programId.equals(RAYDIUM_CLMM_PROGRAM_ID) ||
        ix.programId.equals(TOKEN_PROGRAM_ID)
    );

    if (raydiumClmmIxs.length === 0 && raydium_clmm_inner_ixs.length === 0) return;
    const events = RAYDIUM_CLMM_EVENT_PARSER.parseEvent(tx);
    const result = {
        instructions: raydiumClmmIxs,
        innerInstructions: raydium_clmm_inner_ixs,
        events
    };
    bnLayoutFormatter(result);
    return result;
}



function hydrateLoadedAddresses(tx: VersionedTransactionResponse): VersionedTransactionResponse {
    const loaded = tx.meta?.loadedAddresses;
    if (!loaded) return tx;

    function ensurePublicKey(arr: (Buffer | PublicKey)[]) {
        return arr.map(item =>
            item instanceof PublicKey ? item : new PublicKey(item)
        );
    }

    tx.meta.loadedAddresses = {
        writable: ensurePublicKey(loaded.writable),
        readonly: ensurePublicKey(loaded.readonly),
    };

    return tx;
}

export function parseRaydiumClmmTransaction(tx: any) {
    const txn = TXN_FORMATTER.formTransactionFromJson(
        tx,
        Date.now()
    );

    const parsedTxn = decodeRaydiumClmmTxn(txn);
    if (!parsedTxn) return;
    const raydiumClmmBuySellEvent = parsedTransactionOutput(parsedTxn, txn);
    if (!raydiumClmmBuySellEvent) return;
    // console.log(
    //     new Date(),
    //     ":",
    //     `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
    //     JSON.stringify(raydiumClmmBuySellEvent, null, 2) + "\n"
    // );
    // console.log(
    //     "--------------------------------------------------------------------------------------------------"
    // );
    const result = {
        platform : "RaydiumCLMM",
        type : raydiumClmmBuySellEvent.type,
        feePayer : raydiumClmmBuySellEvent.user,
        mintFrom : raydiumClmmBuySellEvent.mint_B,
        mintTo : raydiumClmmBuySellEvent.mint_A,
        in_amount : raydiumClmmBuySellEvent.amount_in,
        out_amount : raydiumClmmBuySellEvent.amount_out,
    }
    // console.log( result ) ;
    return result ;
}
