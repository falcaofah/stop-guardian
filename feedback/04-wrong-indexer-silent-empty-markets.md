# loadMarkets returns an empty list when the indexer belongs to another network
Severity: normal
Area: SDK

Pointing `SomniaMarkets` at the Hideki chain with the Shannon indexer URL gives no error. `loadMarkets()` resolves to an empty object, so a bot reports "no markets" and looks like the exchange is empty rather than misconfigured.

## Steps to reproduce
1. Build a client for chain 50383 with `indexerUrl: "https://dev.smk.somnia.host/v1/graphql"` (the Shannon indexer) and the Hideki WebSocket URL.
2. Call `await sdk.loadMarkets(true)`.
3. Count the results, then repeat with `https://hideki-dev.smk.somnia.host/v1/graphql`.

## Expected
An error saying the indexer does not serve this chain, since the client knows the chain id it was given.

## Actual
The first call returns 0 markets and no error. The second returns the live markets.

## Evidence
Found while writing `repro/max-size-not-placeable.ts`: the first run printed `markets:` with an empty list and finished normally.

## Environment
@somnia-chain/markets-sdk 0.32.1, Somnia Tokyo testnet (Hideki, chain 50383).
