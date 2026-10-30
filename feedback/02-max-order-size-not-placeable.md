# getMaxPerpOrderSize returns a size the pool rejects about half the time
Severity: major
Area: SDK

`client.getMaxPerpOrderSize()` reports `placeable: true` and a `maxQuantity`, but an order of exactly that quantity reverts with `InsufficientMarginForOrder` in about half of the attempts, for taker and resting orders alike. The same order at 99% of the size was always accepted.

Bots use this read to size "as big as allowed", including the bot kit's `sizeOrder`, so they fail exactly when the account is at its limit.

## Steps to reproduce
1. Use an account with open margin and a key linked to it.
2. Run the read-only script, which only sends `eth_call` simulations:
   `OWNER=0x... OPERATOR=0x... ROUNDS=2 npx tsx repro/max-size-not-placeable.ts`
3. For BTC, ETH, SOL, XRP, HYPE and DOGE, long and short, it reads the maximum for a price and simulates `placeOrderFor` at that same price with 100%, 99%, 98%, 97%, 95% and 90% of it.

## Expected
A quantity returned as the maximum is accepted by the pool when the price and account are unchanged, or the docs state the safety margin a caller must leave.

## Actual
Measured on 2026-10-30, simulated with 60M gas:

| Size | Taker (touch ± 30 bps) | Resting (1% off the book) |
|---|---|---|
| 100% of max | 11/24 accepted | 12/24 accepted |
| 99% of max | 24/24 | 24/24 |
| 90% to 98% of max | all accepted | all accepted |

The read and the simulation are separate calls, so the mark can move between them. That would explain some of the failures, and it is why the read needs a documented margin: the SDK docs list several things the read does not model, but not this one.

## Evidence
`repro/logs/max_size.log`, script `repro/max-size-not-placeable.ts`. No transaction was sent.

## Environment
@somnia-chain/markets-sdk 0.32.1, viem 2.57.13, Somnia Tokyo testnet (Hideki, chain 50383), account 0xC88f17204e8Bea7bA5dbbe817245c5e8922E290C, linked key 0x818EB624d62d2Fe95197e4d2045A8412e7914ad5.
