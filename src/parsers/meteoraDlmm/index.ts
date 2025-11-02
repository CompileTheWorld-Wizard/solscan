import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import { Idl } from "@coral-xyz/anchor";
import { SolanaParser } from "shyft-parser-v2";
import { TransactionFormatter } from "./utils/transaction-formatter";
import meteoraDLMMIdl from "./idls/meteora_dlmm.json";
import { SolanaEventParser } from "./utils/events/event-parser";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";
import { transactionOutput } from "./utils/meteora-dlmm-swap-transaction";

const TXN_FORMATTER = new TransactionFormatter();
const METEORA_DLMM_PROGRAM_ID = new PublicKey(
    "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
);
const METEORA_DLMM_IX_PARSER = new SolanaParser([]);
METEORA_DLMM_IX_PARSER.addParserFromIdl(
    METEORA_DLMM_PROGRAM_ID.toBase58(),
    meteoraDLMMIdl as Idl,
);
const METEORA_DLMM_EVENT_PARSER = new SolanaEventParser([], console);
METEORA_DLMM_EVENT_PARSER.addParserFromIdl(
    METEORA_DLMM_PROGRAM_ID.toBase58(),
    meteoraDLMMIdl as Idl,
);

function decodeMeteoraDLMM(tx: VersionedTransactionResponse) {
    if (tx.meta?.err) return;

    const paredIxs = METEORA_DLMM_IX_PARSER.parseTransactionData(
        tx.transaction.message,
        tx.meta.loadedAddresses,
    );

    const meteora_DLMM_Ixs = paredIxs.filter((ix) =>
        ix.programId.equals(METEORA_DLMM_PROGRAM_ID),
    );

    if (meteora_DLMM_Ixs.length === 0) return;
    const events = METEORA_DLMM_EVENT_PARSER.parseEvent(tx);
    const result = { instructions: meteora_DLMM_Ixs, events };
    bnLayoutFormatter(result);
    return result;
}

export function parseMeteorDlmmTransaction(tx: any) {
    const txn = TXN_FORMATTER.formTransactionFromJson(
        tx,
        Date.now(),
    );
    const parsedInstruction = decodeMeteoraDLMM(txn);

    if (!parsedInstruction) return;
    const formattedSwapTxn = transactionOutput(parsedInstruction, txn)
    if (!formattedSwapTxn) return;
    console.log(
        new Date(),
        ":",
        `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
        JSON.stringify(formattedSwapTxn, null, 2) + "\n",
    );
    console.log(
        "--------------------------------------------------------------------------------------------------"
    );
    const result = {

    }
}
