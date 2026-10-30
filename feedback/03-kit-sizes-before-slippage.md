# Bot kit sizes an order at the touch, then places it at a worse price
Severity: major
Area: SDK

In `dreamdex-bot-kit`, `perp-starter` calls `sizeOrder` with the touch price and passes the result to `placePerp`, which then moves a taker order's price by `slippageBps` (default 20). The pool charges margin at the order's limit price, so a size that fit at the touch no longer fits at the price actually sent.

Any bot that copies this flow and sizes near its maximum gets `InsufficientMarginForOrder`, even with a healthy account.

## Steps to reproduce
1. Use an account with open margin and a key linked to it.
2. Run the read-only script in the mode that follows the kit's order of operations:
   `SIZE_AT_TOUCH=1 OWNER=0x... OPERATOR=0x... ROUNDS=1 npx tsx repro/max-size-not-placeable.ts`
3. It reads the maximum at the touch, then simulates a taker order at the touch ± 30 bps with a share of that maximum. The kit's default is 20 bps; 30 bps is the value used in this test.

## Expected
A size from `sizeOrder` can be placed by `placePerp`. Either `placePerp` applies its slippage before sizing, or `sizeOrder` receives the final limit price and the docs say so.

## Actual
Measured on 2026-10-30, simulated with 60M gas:

| Size | Accepted |
|---|---|
| 100% of max | 0/12 |
| 99% of max | 0/12 |
| 98% of max | 1/12 |
| 97% of max | 2/12 |
| 95% of max | 6/12 |
| 90% of max | 12/12 |

Sizing at the final limit price instead brings 99% of the maximum to 24/24 accepted (see `02-max-order-size-not-placeable.md`).

## Evidence
`repro/logs/max_size_touch.log`. Code: `strategies/perp-starter/src/index.ts` (sizes with `price` at the touch) and `packages/perp-core/src/orders.ts` (`placePerp` adjusts the price afterwards). No transaction was sent.

## Environment
dreamdex-bot-kit 4e75896, @somnia-chain/markets-sdk 0.32.1 for the script, Somnia Tokyo testnet (Hideki, chain 50383), account 0xC88f17204e8Bea7bA5dbbe817245c5e8922E290C.
