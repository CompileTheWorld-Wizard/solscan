const mintAddress = "DruhxNiKffgFDoXw2zJLz5qZM3UxP182XomfhxQHpump";

async function main() {
    const response = await fetch("https://mainnet.helius-rpc.com/?api-key=fbcf4553-f7c1-4fa8-b33d-36540cfc9676", {
        
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: "find-first-mints",
            method: "getTransactionsForAddress",
            params: [
                mintAddress,
                {
                    encoding: "jsonParsed",
                    maxSupportedTransactionVersion: 0,
                    sortOrder: "asc",
                    limit: 20,
                    transactionDetails: "signatures",
                    filters: {
                        status: "succeeded"
                    }
                },
            ],
        }),
    });
    const data = await response.json();
    console.log(data);
}
main()