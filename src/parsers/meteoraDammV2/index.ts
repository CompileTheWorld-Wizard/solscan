import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import { Idl } from "@coral-xyz/anchor";
import { SolanaParser } from "shyft-parser-v2"; 
import { TransactionFormatter } from "./utils/transaction-formatter";
import meteoradammV2Idl from "./idls/meteora_dammV2.json";
import { SolanaEventParser } from "./utils/event-parser";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";
import { meteoradammV2TransactionOutput } from "./utils/meteora_dammV2_transaction_output"; 

const TXN_FORMATTER = new TransactionFormatter();
const METEORA_dammV2_PROGRAM_ID = new PublicKey(
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
);
const METEORA_dammV2_IX_PARSER = new SolanaParser([]);
METEORA_dammV2_IX_PARSER.addParserFromIdl(
  METEORA_dammV2_PROGRAM_ID.toBase58(),
  meteoradammV2Idl as Idl,
);
const METEORA_dammV2_EVENT_PARSER = new SolanaEventParser([], console);
METEORA_dammV2_EVENT_PARSER.addParserFromIdl(
  METEORA_dammV2_PROGRAM_ID.toBase58(),
  meteoradammV2Idl as Idl,
);

function decodeMeteoradammV2(tx: VersionedTransactionResponse) {
    if (tx.meta?.err) return;
    try {
        const paredIxs = METEORA_dammV2_IX_PARSER.parseTransactionData(
            tx.transaction.message,
            tx.meta.loadedAddresses,
        );

        const meteora_dammV2_Ixs = paredIxs.filter((ix) =>
            ix.programId.equals(METEORA_dammV2_PROGRAM_ID) || ix.programId.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
        );

        const parsedInnerIxs = METEORA_dammV2_IX_PARSER.parseTransactionWithInnerInstructions(tx);

        const meteroa_dammV2_inner_ixs = parsedInnerIxs.filter((ix) =>
            ix.programId.equals(METEORA_dammV2_PROGRAM_ID) || ix.programId.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
        );


        if (meteora_dammV2_Ixs.length === 0) return;
        const events = METEORA_dammV2_EVENT_PARSER.parseEvent(tx);
        const result = { instructions: meteora_dammV2_Ixs, inner_ixs: meteroa_dammV2_inner_ixs, events };
        bnLayoutFormatter(result);
        return result;
    } catch (err) {
    }
}
export function parseMeteoraDammV2Transaction(tx: any) {
    const txn = TXN_FORMATTER.formTransactionFromJson(
        tx,
        Date.now(),
    );
    const parsedInstruction = decodeMeteoradammV2(txn);

    if (!parsedInstruction) return;
    const parsedMeteoradammV2 = meteoradammV2TransactionOutput(parsedInstruction, txn)
    if (!parsedMeteoradammV2) return;
    console.log(
        new Date(),
        ":",
        `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
        JSON.stringify(parsedMeteoradammV2, null, 2) + "\n"
    );
    console.log(
        "--------------------------------------------------------------------------------------------------"
    );
}
