# Bot kit pins an SDK version whose socket never recovers from a long outage
Severity: major
Area: SDK

`dreamdex-bot-kit` depends on `@somnia-chain/markets-sdk` `^0.31.0`. A caret on a 0.x version does not allow 0.32, so kit users stay on a version where, after an outage of a few minutes, every chain read keeps failing with `WebSocket request failed` after the network is back. The process stays alive, so nothing restarts it, and a bot holding a position can no longer see or manage it.

SDK 0.32.1 recovers from the same outage, so the fix looks like a dependency bump in the kit.

This happened to us for real on 2026-10-27: 511 consecutive failures over about 5.5 hours, with a 20x position open, until the process was restarted.

## Steps to reproduce
1. Run the read-only script, which sends only `getBlockNumber` through a local proxy it can switch off, from a folder that resolves SDK 0.31.0 (`packages/perp-core` in the kit):
   `npx tsx ws-no-reconnect.ts 360 kill`
2. The proxy cuts the connection at t=15s and comes back at t=375s. The script keeps reading until t=510s.
3. Repeat with SDK 0.32.1.

## Expected
Reads recover shortly after the network returns, on the version the kit installs.

## Actual

| Stack | Outage | Result |
|---|---|---|
| SDK 0.31.0, viem 2.54.1 | 360 s | **Never recovers** (run twice): 135 s after the network is back, reads still fail |
| SDK 0.32.1, viem 2.54.1 | 360 s | Recovers within about 3 s |
| SDK 0.32.1, viem 2.57.13 | 360 s | Recovers within about 2 s |
| SDK 0.31.0, viem 2.54.1 | 40 s | Recovers, about 8 s after the network is back |

The second row points to the SDK rather than viem as the source of the fix. Short outages recover on every version, so this does not show up in a quick test. At the end of every run, a brand-new socket to the same node connects immediately, so the node is healthy.

## Evidence
`repro/logs/o31_kill360.log`, `o31_kill360_run2.log`, `n32_viem254_kill360.log`, `n32_kill360.log` and `o31_kill40.log`. Script: `repro/ws-no-reconnect.ts`. No transaction was sent.

`packages/perp-core/package.json` at kit commit 4e75896: `"@somnia-chain/markets-sdk": "^0.31.0"`.

## Environment
dreamdex-bot-kit 4e75896, @somnia-chain/markets-sdk 0.31.0 and 0.32.1, Node 24, Somnia Tokyo testnet (Hideki, chain 50383).
