import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import { Idl } from "@project-serum/anchor";
import { SolanaParser } from "shyft-parser-v1";

import { TransactionFormatter } from "./utils/transaction-formatter";
import whirlpoolIDL from "./idls/whirlpool_idl.json";
import {orca_formatter} from "./utils/orca-transaction-formatter"

import { bnLayoutFormatter } from "./utils/bn-layout-formatter";

const ORCA_PROGRAM_ID = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const SOL_MINT = "So11111111111111111111111111111111111111112";

const TXN_FORMATTER = new TransactionFormatter();
const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
)
const WHIRLPOOL_IX_PARSER = new SolanaParser([]);
WHIRLPOOL_IX_PARSER.addParserFromIdl(
  WHIRLPOOL_PROGRAM_ID.toBase58(),
  whirlpoolIDL as Idl,
);  
function decodeWhirlpoolTxn(tx: VersionedTransactionResponse) {
  if (tx.meta?.err) return;

  const paredIxs = WHIRLPOOL_IX_PARSER.parseTransactionData(
    tx.transaction.message,
    tx.meta.loadedAddresses,
  );

  const parsedInnerIxs = WHIRLPOOL_IX_PARSER.parseTransactionWithInnerInstructions(
    tx
  );

  const compiledIxs = paredIxs.filter((ix) =>
    ix.programId.equals(WHIRLPOOL_PROGRAM_ID) || ix.programId.equals(TOKEN_PROGRAM_ID),
  );

  const parsedFilteredInnerIxs = parsedInnerIxs.filter((ix) =>
    ix.programId.equals(WHIRLPOOL_PROGRAM_ID) || ix.programId.equals(TOKEN_PROGRAM_ID),
  );

  const result = { compiledInstructions: compiledIxs, innerInstructions: parsedFilteredInnerIxs };
  bnLayoutFormatter(result);
  return result;
}

export function parseOrcaTransaction(tx: any) {
    const txn = TXN_FORMATTER.formTransactionFromJson(
      tx,
      Date.now(),
    );

    //console.log("Txn Received: ", txn.transaction.signatures[0]);

    const parsedTxn = decodeWhirlpoolTxn(txn);

    if (!parsedTxn) return;
    const formatterOrcaTxn = orca_formatter(parsedTxn,txn);
    if(!formatterOrcaTxn) return;

    console.log(
      new Date(),
      ":",
      `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
      JSON.stringify(formatterOrcaTxn.output, null, 2) + "\n",
      formatterOrcaTxn.transactionEvent
    ); 
  console.log(
    "--------------------------------------------------------------------------------------------------"
  );
}

