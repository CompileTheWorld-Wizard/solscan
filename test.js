// import { Idl } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { Parser } from "@shyft-to/ladybug-sdk";
import pumpIdl from "./src/services/idls/pumpfun/pump_0.1.0.json" assert { type: "json" };
import pumpAmmIdl from "./src/services/idls/pumpAmm/pump_amm_0.1.0.json" assert { type: "json" };

async function getAndParseTxn() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");

  const parser = new Parser();
  parser.addIDL(new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"), pumpIdl );
  parser.addIDL(new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"), pumpAmmIdl );
  parser.useDefaultInstructionParsing(true);

  const txnSignature = "4rCtASJ6Y9b73gd8vQjYut6LHiUcKuaxGHN9WDqgxsA3Zy2J1bq5rShLV9Qrage28werwsgMGDdPQ6nH2KpJVcKu";

  const transaction = await connection.getTransaction(txnSignature, {
      maxSupportedTransactionVersion: 0
    });
  
  if(!transaction) throw new Error("Transaction not found");
  const parsed = parser.parseTransaction(transaction);

  console.log(JSON.stringify(parsed));
}

getAndParseTxn();