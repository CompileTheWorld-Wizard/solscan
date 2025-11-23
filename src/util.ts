import * as bs58 from "bs58";

export const detectSwapPlatform = ( tx : any ) => {
    const swapPlatforms = [
        // {
        //     name: "RaydiumAmm",
        //     programId: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
        // },
        // {
        //     name: "RaydiumCpmm",
        //     programId: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
        // },
        // {
        //     name: "RaydiumClmm",
        //     programId: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
        // },
        // {
        //     name: "RaydiumLaunchPad",
        //     programId: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
        // },
        // {
        //     name: "Orca",
        //     programId: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
        // },
        // {
        //     name: "MeteoraDLMM",
        //     programId: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
        // },
        // {
        //     name: "MeteoraDammV2",
        //     programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
        // },
        // {
        //     name: "MeteoraDBC",
        //     programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
        // },
        {
            name: "PumpFun",
            programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
        },
        {
            name: "PumpFun Amm",
            programId: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
        }
    ];
    // Get account keys from the transaction message
    // console.log(JSON.stringify(tx))
    // const accountKeys = [...tx.transaction.message.accountKeys, ...tx.meta?.loadedAddresses?.writable, ...tx.meta?.loadedAddresses?.readonly];
    
    // // Convert account keys (Buffers) to base58 strings
    // const accountKeysBase58 = accountKeys.map((key: Buffer | Uint8Array) => {
    //     return bs58.encode(key);
    // });

    for (const platform of swapPlatforms) {
        // Check if the platform's program ID appears in any account key
        // const hasMatch = accountKeysBase58.some((accountKey: string) => {
        //     return accountKey === platform.programId;
        // });
        const hasMatch = tx.meta.logMessages.some((message: string) => {
            return message.includes(platform.programId);
        });
        
        if (hasMatch) {
            console.log(`\n✓ DETECTED: ${platform.name}\n`);
            return platform.name;
        }
    }
    
    // console.log(bs58.encode(tx?.signatures[0] || ""))
    // console.log(JSON.stringify(tx))
    // console.log(accountKeysBase58)
    return null;
}