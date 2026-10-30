// The loop. On a run of failed reads it exits and the supervisor starts a fresh process:
// a socket stuck after a long outage has been seen to stay stuck, and a new process always connects.
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { config as loadEnv } from "./env.ts";
import { Chain } from "./chain.ts";
import { Guardian } from "./guardian.ts";
import { RuleStore } from "./store.ts";
import { Telegram } from "./telegram.ts";

const env = loadEnv();
const POLL_MS = Number(env.POLL_MS ?? 3000);
const BLIND_ALERT_AFTER = 5;
const RESTART_AFTER = 20;
const INBOX = "data/inbox.txt";

const owner = env.OWNER_ADDRESS as `0x${string}` | undefined;
if (!owner) throw new Error("set OWNER_ADDRESS in .env");

const dryRun = (env.DRY_RUN ?? "true").toLowerCase() !== "false";
const privateKey = (env.PRIVATE_KEY || undefined) as `0x${string}` | undefined;
if (!dryRun && !privateKey) throw new Error("DRY_RUN=false needs PRIVATE_KEY, a key linked to the account");

const chain = new Chain({
  owner, privateKey, dryRun,
  rpcUrl: env.RPC_URL ?? "https://api.hideki2.infra.testnet.somnia.network",
  wsUrl: env.WS_RPC_URL ?? "wss://api.hideki2.infra.testnet.somnia.network/ws",
  indexerUrl: env.INDEXER_URL ?? "https://hideki-dev.smk.somnia.host/v1/graphql",
  chainId: Number(env.CHAIN_ID ?? 50383),
  evidenceFile: "data/orders.jsonl",
});
const tg = new Telegram(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID);
const guardian = new Guardian(chain, new RuleStore("data/rules.json"), tg);

/** Commands from a local file too, so it works without Telegram. */
function localInbox(): string[] {
  if (!existsSync(INBOX)) return [];
  const tmp = `${INBOX}.reading`;
  renameSync(INBOX, tmp);
  const lines = readFileSync(tmp, "utf8").split(/\r?\n/).filter(Boolean);
  rmSync(tmp);
  return lines;
}

await tg.send(`Stop Guardian on · ${owner.slice(0, 6)}…${owner.slice(-4)} · ${dryRun ? "DRY_RUN, nothing is sent" : "LIVE"}`);

let failures = 0;
let blindSince = 0;
for (;;) {
  try {
    for (const text of [...(await tg.inbox()), ...localInbox()]) await guardian.command(text);
    await guardian.tick();
    if (blindSince) await tg.send(`✅ Back. Blind for ${Math.round((Date.now() - blindSince) / 1000)}s.`);
    failures = 0;
    blindSince = 0;
  } catch (e) {
    failures++;
    blindSince ||= Date.now();
    console.error(`read failed (${failures}): ${(e as Error).message.split("\n")[0].slice(0, 120)}`);
    if (failures === BLIND_ALERT_AFTER) await tg.send("🙈 Blind: chain reads are failing, levels are not being watched. Restarting if it continues.");
    if (failures >= RESTART_AFTER) {
      await tg.send("♻️ Restarting with a fresh connection.");
      process.exit(75);
    }
  }
  if (env.ONCE) process.exit(0);
  await new Promise((r) => setTimeout(r, POLL_MS));
}
