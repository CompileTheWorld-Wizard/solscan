import { Connection, PublicKey } from "@solana/web3.js";
import * as bs58 from "bs58";
import { TransactionFormatter } from "./utils/transaction-formatter";
import { PumpAmmDecoder } from "./utils/decode-parser";
import { parseSwapTransactionOutput } from "./utils/swapTransactionParser";

const PUMP_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const SOL_MINT = "So11111111111111111111111111111111111111112";

const pumpAmmDecoder = new PumpAmmDecoder();
const TXN_FORMATTER = new TransactionFormatter();

export function parsePumpAmmTransaction(tx: any) {
  const txn = TXN_FORMATTER.formTransactionFromJson(
    tx,
    Date.now()
  );

 const parsedTxn = pumpAmmDecoder.decodePumpAmmTxn(txn);
 const formattedSwapTxn = parseSwapTransactionOutput(parsedTxn,txn);
 
  if(!formattedSwapTxn) return;
  // console.log(
  //   new Date(),
  //   ":",
  //   `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
  //   JSON.stringify(formattedSwapTxn, null, 2) + "\n",
  // );
  //Reverted buy/sell
  formattedSwapTxn.type = formattedSwapTxn.type === 'buy' ? 'sell' : 'buy'
  const result = {
    platform : "PumpAmm",
    type : formattedSwapTxn.type,
    feePayer : formattedSwapTxn.feePayer,
    creator : formattedSwapTxn.creator,
    mintFrom : formattedSwapTxn.type == 'sell' ? formattedSwapTxn.mint : SOL_MINT,
    mintTo : formattedSwapTxn.type == 'sell' ? SOL_MINT : formattedSwapTxn.mint,
    in_amount : formattedSwapTxn.in_amount,
    out_amount : formattedSwapTxn.out_amount,
    price : formattedSwapTxn.price,
    pool : formattedSwapTxn.pool
  } ;
  // console.log(result);
  return result ;
}

