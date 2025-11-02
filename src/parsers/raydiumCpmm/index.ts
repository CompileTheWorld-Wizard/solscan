import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import { Idl } from "@project-serum/anchor";
import { SolanaParser } from "shyft-parser-v1";
import { parsedTransactionOutput } from "./utils/parsedTransactionOutput";
import { TransactionFormatter } from "./utils/transaction-formatter";
import cpmmIDL from "./idls/cpmm_idl.json";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const TXN_FORMATTER = new TransactionFormatter();
const CPMM_PROGRAM_ID = new PublicKey(
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
)
const CPMM_IX_PARSER = new SolanaParser([]);
CPMM_IX_PARSER.addParserFromIdl(
  CPMM_PROGRAM_ID.toBase58(),
  cpmmIDL as Idl,
);

function decodeCpmmTxn(tx: VersionedTransactionResponse) {
    if (tx.meta?.err) return;
  
    const paredIxs = CPMM_IX_PARSER.parseTransactionData(
      tx.transaction.message,
      tx.meta.loadedAddresses,
    );
  
    const parsedInnerIxs = CPMM_IX_PARSER.parseTransactionWithInnerInstructions(
      tx
    );
  
    const compiledIxs = paredIxs.filter((ix) =>
      ix.programId.equals(CPMM_PROGRAM_ID) || ix.programId.equals(TOKEN_PROGRAM_ID),
    );
  
    const parsedFilteredInnerIxs = parsedInnerIxs.filter((ix) =>
      ix.programId.equals(CPMM_PROGRAM_ID) || ix.programId.equals(TOKEN_PROGRAM_ID),
    );
  
    const result = { compiledInstructions: compiledIxs, innerInstructions: parsedFilteredInnerIxs };
    bnLayoutFormatter(result);
    return result;
  }
  

export function parseRaydiumCpmmTransaction(tx: any) {
    const txn = TXN_FORMATTER.formTransactionFromJson(
      tx,
      Date.now(),
    );

    const parsedTxn = decodeCpmmTxn(txn);
    if (!parsedTxn) return; 
    const formattedTxn = parsedTransactionOutput(parsedTxn,txn);
    console.log(formattedTxn)
     if (!formattedTxn) return;
    //  console.log(
    //    new Date(),
    //    ":",
    //    `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
    //   //  JSON.stringify(formattedTxn.rpcTxnWithParsed, null, 2) + "\n",
    //   formattedTxn.transactionEvent,
    // );
    const result = {
        platform : "RaydiumCPMM",
        type : formattedTxn.transactionEvent.type,
        feePayer : formattedTxn.transactionEvent.user,
        mintFrom : formattedTxn.transactionEvent.type == 'Buy' ? SOL_MINT : formattedTxn.transactionEvent.mint,
        mintTo : formattedTxn.transactionEvent.type == 'Buy' ? formattedTxn.transactionEvent.mint : SOL_MINT,
        in_amount : formattedTxn.transactionEvent.amount,
        out_amount : formattedTxn.transactionEvent.amount_out,
    }
    // console.log( result ) ;
    return result ;
}
