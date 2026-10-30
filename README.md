# Stop Guardian

A safety net for dreamDEX perps. It watches your account, tells you when a position has no stop, and closes the position at the levels you set from Telegram. It uses a linked key that can trade but cannot withdraw.

**Who it is for:** anyone trading perps by hand or with a bot, especially at high leverage.

## Why it exists

Two things happened to us while running a bot in the Perps Arena:

- A 20x position sat unmanaged for 5.5 hours, because the bot's connection died while its process stayed alive.
- Stop orders can only be armed by the account itself, so a linked key cannot place them.

Stop Guardian covers both. It gives a linked key working stop levels, and it treats losing sight of the chain as an emergency.

## What it does

| | |
|---|---|
| **Finds unprotected positions** | Sees every open position, in any market, and warns when one has no stop. It recognises on-chain stops too. |
| **Closes at your levels** | `/sl` and `/tp` from Telegram. When the mark crosses a level, it closes the whole position. |
| **Gets out reliably** | Estimates gas instead of using a fixed limit, retries with wider slippage, and re-reads the position each round, so a retry cannot open the other way. |
| **Says when it is blind** | Alerts over plain HTTP when chain reads fail, then restarts itself with a fresh connection. |
| **Warns before liquidation** | Alerts when the mark is within 2% of the liquidation price. |

It only acts on levels you set. Without levels it only warns, so it can run next to any bot.

```
/status       positions and how each is protected
/sl ETH 2425  close ETH if the mark reaches 2425
/tp ETH 2510  close ETH if the mark reaches 2510
/clear ETH    remove the levels
```

## How to run it

Needs Node 20 or newer.

```bash
npm install
cp .env.example .env
npm start
```

In `.env`, set `OWNER_ADDRESS` to your DreamDEX account. It starts with `DRY_RUN=true`: it reads everything, says what it would do, and sends nothing.

To let it close positions, link a key in the app (wallet > Link a bot > Perps), set it as `PRIVATE_KEY`, and set `DRY_RUN=false`. **Never use your main wallet key.**

Telegram is optional: set `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID`. Without them, messages go to the console and commands can be written to `data/inbox.txt`, one per line. Only the configured chat can send commands.

```bash
npm test
```

## Limits

This is a stop that runs on your machine, not on the chain, so it only works while it is running. It reacts to the mark on each check (every 3 seconds by default), so in a fast move the fill can be worse than your level. Where you hold the owner key, a real on-chain stop is stronger. See `feedback/05-trading-key-cannot-arm-stops.md` for the change that would remove this limit.

Testnet only for now: perps are not on mainnet yet.

## Evidence

<!-- Filled in once live orders have run: transaction hashes and a demo link. -->

Live orders on Somnia Tokyo testnet: *pending*.

## X posts

<!-- 2 or 3 posts tagging @DreamDEXSomnia. -->

*Pending.*

## Feedback track

Reports are in [`feedback/`](feedback), one per issue, with the scripts that reproduce them in [`repro/`](repro). The scripts only read and simulate; they send no transactions.
