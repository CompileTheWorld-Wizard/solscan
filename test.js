import fetch from "node-fetch";

async function getSocials(mint) {
  const apiKey = "C5WUfQxUvSmrEBES";
  const query = `
    query GetTokenMeta($mint: String!) {
      solana {
        tokens(where: { mint: { _eq: $mint } }) {
          metadataUri
        }
      }
    }`;
  const res = await fetch(`https://programs.shyft.to/v0/graphql/?api_key=${apiKey}&network=mainnet-beta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { mint } })
  });
  const data = await res.json();
  const uri = data?.data?.solana?.tokens?.[0]?.metadataUri;
  if (!uri) throw new Error("No metadata URI found");
  const meta = await fetch(uri).then(r => r.json());
  return meta.extensions || {};
}

getSocials("8zKRLUuJwMZyEv8rgr8mXgxqJdVuB2Lg84JGi8L4PuQe").then(console.log);