import { Idl } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { Parser } from "@shyft-to/ladybug-sdk";
import pumpIdl from "./src/services/idls/pumpfun/pump_0.1.0.json";
import pumpAmmIdl from "./src/services/idls/pumpAmm/pump_amm_0.1.0.json";
import dflowIDL from "./dflow.json";

async function getAndParseTxn() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");

  const parser = new Parser();
  parser.addIDL(new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"), pumpIdl as Idl);
  parser.addIDL(new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"), pumpAmmIdl as Idl);
  parser.addIDL(new PublicKey("DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH"), dflowIDL as Idl);
  parser.useDefaultInstructionParsing(true);

  // const txnSignature = "JEpJbn2V298jsJhehvRxLR2r2CLKun1rLLmKgZg5mkgr2nUj27d3XoD95vHMG2Fg6RCWYNZBJLEk1RuRt2wZJXH";
  const txnSignature = "4rCtASJ6Y9b73gd8vQjYut6LHiUcKuaxGHN9WDqgxsA3Zy2J1bq5rShLV9Qrage28werwsgMGDdPQ6nH2KpJVcKu";

  const transaction = await connection.getTransaction(txnSignature, {
      maxSupportedTransactionVersion: 0
    });
  
  if(!transaction) throw new Error("Transaction not found");
  const parsed = parser.parseTransaction(transaction);

  console.log(JSON.stringify(parsed));
}

getAndParseTxn();