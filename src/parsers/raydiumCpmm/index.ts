import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import { Idl } from "@coral-xyz/anchor";
import { SolanaParser } from "shyft-parser-v2";
import { raydiumCPFormatter } from "./utils/parsedTransactionOutput";
import { TransactionFormatter } from "./utils/transaction-formatter";
import { SolanaEventParser } from "./utils/event-parser";
import raydiumCPIdl from "./idls/raydium_cp.json";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const TXN_FORMATTER = new TransactionFormatter();
const RAYDIUM_CP_PROGRAM_ID = new PublicKey(
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const RAYDIUM_CP_IX_PARSER = new SolanaParser([]);
RAYDIUM_CP_IX_PARSER.addParserFromIdl(
  RAYDIUM_CP_PROGRAM_ID.toBase58(),
  raydiumCPIdl as Idl
);
const RAYDIUM_CP_EVENT_PARSER = new SolanaEventParser([], console);
RAYDIUM_CP_EVENT_PARSER.addParserFromIdl(
  RAYDIUM_CP_PROGRAM_ID.toBase58(),
  raydiumCPIdl as Idl
);

function decodeRaydiumCPTxn(tx: VersionedTransactionResponse) {
  if (tx.meta?.err) return;
  const hydratedTx = hydrateLoadedAddresses(tx);

  const paredIxs = RAYDIUM_CP_IX_PARSER.parseTransactionData(
    hydratedTx.transaction.message,
    hydratedTx.meta.loadedAddresses
  );
  const raydiumCPIxs = paredIxs.filter((ix) =>
    ix.programId.equals(RAYDIUM_CP_PROGRAM_ID) ||
    ix.programId.equals(TOKEN_PROGRAM_ID)
  );
  const parsedInnerIxs = RAYDIUM_CP_IX_PARSER.parseTransactionWithInnerInstructions(hydratedTx);

  let raydium_CP_inner_ixs = parsedInnerIxs.filter((ix) =>
    ix.programId.equals(RAYDIUM_CP_PROGRAM_ID) ||
    ix.programId.equals(TOKEN_PROGRAM_ID)
  );

  if (raydiumCPIxs.length === 0 && raydium_CP_inner_ixs.length === 0) return;
  const ev = RAYDIUM_CP_EVENT_PARSER.parseEvent(tx);
  const events = Array.isArray(ev)
    ? (ev.length ? ev : RAYDIUM_CP_EVENT_PARSER.parseCpiEvent(tx))
    : ev;
  const result = {
    instructions: raydiumCPIxs,
    innerInstructions: raydium_CP_inner_ixs,
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


export function parseRaydiumCpmmTransaction(tx: any) {
  const txn = TXN_FORMATTER.formTransactionFromJson(
    tx,
    Date.now(),
  );

  const parsedTxn = decodeRaydiumCPTxn(txn);
  if (!parsedTxn) return;

  const raydiumCPTransactions = raydiumCPFormatter(parsedTxn, txn);

  if (!raydiumCPTransactions) return;
  const result = {
    platform: "RaydiumCPMM",
    type: raydiumCPTransactions?.type || '',
    feePayer: raydiumCPTransactions?.payer || '',
    mintFrom: raydiumCPTransactions?.inputToken,
    mintTo: raydiumCPTransactions?.outputToken,
    in_amount: raydiumCPTransactions?.inAmount || '',
    out_amount: raydiumCPTransactions?.outAmount || '',
    price: raydiumCPTransactions?.price || '',
  }
  // console.log( result ) ;
  return result;
}
