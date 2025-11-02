import { TransactionFormatter } from "./utils/transaction-formatter";
import { VersionedTransactionResponse } from "@solana/web3.js";
import { SolanaParser } from "shyft-parser-v1";
import { RaydiumAmmParser } from "./parsers/raydium-amm-parser";
import { LogsParser } from "./parsers/logs-parser";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";
import { transactionEventParser } from "./utils/transaction-event-parser";

const RAYDIUM_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const RAYDIUM_PUBLIC_KEY = RaydiumAmmParser.PROGRAM_ID;
const TXN_FORMATTER = new TransactionFormatter();
const raydiumAmmParser = new RaydiumAmmParser();
const IX_PARSER = new SolanaParser([]);
const SOL_MINT = "So11111111111111111111111111111111111111112";
IX_PARSER.addParser(
  RaydiumAmmParser.PROGRAM_ID,
  raydiumAmmParser.parseInstruction.bind(raydiumAmmParser),
);
const LOGS_PARSER = new LogsParser();

function decodeRaydiumTxn(tx: VersionedTransactionResponse) {
  if (tx.meta?.err) return;

  const parsedIxs = IX_PARSER.parseTransactionWithInnerInstructions(tx);

  const programIxs = parsedIxs.filter((ix) =>
    ix.programId.equals(RAYDIUM_PUBLIC_KEY),
  );

  if (programIxs.length === 0) return;
  const LogsEvent = LOGS_PARSER.parse(parsedIxs, tx.meta.logMessages);
  const result = { instructions: parsedIxs, events: LogsEvent };
  bnLayoutFormatter(result);
  return result;
}


export function parseRaydiumAmmTransaction(tx: any) {
  const txn = TXN_FORMATTER.formTransactionFromJson(
    tx,
    Date.now(),
  );
  const parsedTxn = decodeRaydiumTxn(txn);

  if (!parsedTxn) return;

  const eventParser = transactionEventParser(txn, parsedTxn)

  // console.log(
  //   new Date(),
  //   ":",
  //   `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
  //   // JSON.stringify(parsedTxn, null, 2) + "\n",
  //   eventParser,
  // );
  const result = {
    platform : "RaydiumAmm",
    type : eventParser["Type: "] ,
    feePayer : eventParser["User: "],
    mintFrom : eventParser["Type: "] == "Buy" ? SOL_MINT :eventParser["Mint: "],
    mintTo : eventParser["Type: "] == "Buy" ? eventParser["Mint: "] : SOL_MINT,
    in_amount : eventParser["Amount in: "],
    out_amount : eventParser["Amount out: "],
  }
  return result ;
}
