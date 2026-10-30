# Missing feature: a linked trading key cannot arm TP/SL for the account
Severity: normal
Area: contracts

A key linked through "Link a bot" can place and cancel orders for the account, but it cannot arm stop orders. `docs/perps.md` in the bot kit states this: "Stop orders can only be armed by the account itself."

So the safest way to run a bot, a key with no withdrawal power, is also the one that cannot use on-chain protection. The bot has to watch the mark itself, and the position has no stop whenever the bot is offline, which is when a stop matters most. The alternative is giving a bot the main wallet key, which is the habit this product should discourage.

## Steps to reproduce
1. Link a key to an account in the app (wallet > Link a bot > Perps).
2. Set `OWNER_ADDRESS` and `PRIVATE_KEY` in the bot kit, so the SDK gets the owner as a bare address and is read-only for it.
3. Look for a way to arm a stop for the owner: `trader.placePerpStopOrder` needs the owner's signer, and the SDK has no `...For` variant.

## Expected
A `placePerpStopOrderFor`-style path on the stop registry, limited to reduce-only orders on the owner's positions. It would add no withdrawal risk and would let linked keys protect a position while offline.

## Actual
No path exists. `perp-starter` watches levels in-process instead, which the docs note "only works while the bot is running".

## Evidence
`docs/perps.md` ("What a trading key cannot do") and `packages/perp-core/src/exchange.ts` in the bot kit. A search of the SDK source for a `StopOrderFor` function finds nothing.

## Environment
dreamdex-bot-kit 4e75896, @somnia-chain/markets-sdk 0.32.1, Somnia Tokyo testnet (Hideki, chain 50383).
