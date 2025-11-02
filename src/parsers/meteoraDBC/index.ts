import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import { Idl } from "@coral-xyz/anchor";
import { SolanaParser } from "shyft-parser-v2";
import { TransactionFormatter } from "./utils/transaction-formatter";
import meteoraDBCIdl from "./idls/meteora_dbc.json";
import { SolanaEventParser } from "./utils/event/event-parser";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";
import { meteoradbcTransactionOutput } from "./utils/meteora_dbc_transaction_output";

const TXN_FORMATTER = new TransactionFormatter();
const METEORA_DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
);
const METEORA_DBC_IX_PARSER = new SolanaParser([]);
METEORA_DBC_IX_PARSER.addParserFromIdl(
  METEORA_DBC_PROGRAM_ID.toBase58(),
  meteoraDBCIdl as Idl,
);
const METEORA_DBC_EVENT_PARSER = new SolanaEventParser([], console);
METEORA_DBC_EVENT_PARSER.addParserFromIdl(
  METEORA_DBC_PROGRAM_ID.toBase58(),
  meteoraDBCIdl as Idl,
);

function decodeMeteoraDBC(tx: VersionedTransactionResponse) {
    if (tx.meta?.err) return;
    try{
    const paredIxs = METEORA_DBC_IX_PARSER.parseTransactionData(
      tx.transaction.message,
      tx.meta.loadedAddresses,
    );
  
    const meteora_DBC_Ixs = paredIxs.filter((ix) =>
      ix.programId.equals(METEORA_DBC_PROGRAM_ID) || ix.programId.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
    );
  
    const parsedInnerIxs = METEORA_DBC_IX_PARSER.parseTransactionWithInnerInstructions(tx);
  
    const meteroa_dbc_inner_ixs = parsedInnerIxs.filter((ix) =>
      ix.programId.equals(METEORA_DBC_PROGRAM_ID) || ix.programId.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
    );
  
  
    if (meteora_DBC_Ixs.length === 0) return;
    const events = METEORA_DBC_EVENT_PARSER.parseEvent(tx);
    const result = { instructions: meteora_DBC_Ixs, inner_ixs:  {meteroa_dbc_inner_ixs, events} };
    bnLayoutFormatter(result);
    return result;
    }catch(err){
    }
}
export function parseMeteoraDBCTransaction(tx: any) {
    const txn = TXN_FORMATTER.formTransactionFromJson(
      tx,
      Date.now(),
    );
    const parsedInstruction = decodeMeteoraDBC(txn);

    if (!parsedInstruction) return;
    const parsedMeteoraDbc = meteoradbcTransactionOutput(parsedInstruction,txn)
   console.log(
      new Date(),
      ":",
      `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
      JSON.stringify(parsedMeteoraDbc, null, 2) + "\n"
    );
    console.log(
      "--------------------------------------------------------------------------------------------------"
    );
}
