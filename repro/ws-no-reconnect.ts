// Reproduces: on SDK 0.31.0 the chain client never recovers from a long outage (0.32.1 does).
// Read-only: only getBlockNumber. Usage: npx tsx repro/ws-no-reconnect.ts <outageSeconds>
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { defineChain } from "viem";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";

const UPSTREAM = "wss://api.hideki2.infra.testnet.somnia.network/ws";
const PORT = Number(process.env.PROXY_PORT ?? 18546);
const OUTAGE_S = Number(process.argv[2] ?? 30);
const MODE = process.argv[3] ?? "kill"; // kill: sockets die and the port closes. blackhole: sockets stay open, nothing answers.
let hole = false;
const t0 = Date.now();
const log = (s: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${s}`);

// A local pass-through we can switch off, standing in for a network outage.
let wss: WebSocketServer | undefined;
let http: ReturnType<typeof createServer> | undefined;
function up() {
  http = createServer();
  wss = new WebSocketServer({ server: http });
  wss.on("connection", (c) => {
    log("proxy: client connected");
    const u = new WebSocket(UPSTREAM);
    const q: any[] = [];
    u.on("open", () => { for (const m of q) u.send(m); q.length = 0; });
    u.on("message", (m, b) => !hole && c.readyState === 1 && c.send(m, { binary: b }));
    c.on("message", (m, b) => { if (hole) return; if (u.readyState === 1) u.send(m, { binary: b }); else q.push(m); });
    c.on("close", () => u.close());
    u.on("close", () => c.close());
    u.on("error", () => c.close());
  });
  http.listen(PORT, "127.0.0.1");
}
function down() {
  for (const c of wss?.clients ?? []) c.terminate();
  wss?.close();
  http?.close();
  http?.closeAllConnections();
}

const chain = defineChain({ id: 50383, name: "hideki", nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.hideki2.infra.testnet.somnia.network"], webSocket: [`ws://127.0.0.1:${PORT}`] } } });
const sdk = new SomniaMarkets({ indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql", chain, wsRpcUrl: `ws://127.0.0.1:${PORT}`, addresses: SOMNIA_TESTNET_ADDRESSES });
const client = sdk.client.getViemClient();

up();
let ok = 0, fail = 0, last = "";
const stopAt = OUTAGE_S + 150;
log(`outage ${OUTAGE_S}s starts at t=15s; watching until t=${stopAt}s`);
setTimeout(() => { log(`>>> network DOWN (${MODE})`); if (MODE === "kill") down(); else hole = true; }, 15_000);
setTimeout(() => { log("<<< network UP again"); if (MODE === "kill") up(); else hole = false; }, (15 + OUTAGE_S) * 1000);

while ((Date.now() - t0) / 1000 < stopAt) {
  try {
    const n = await client.getBlockNumber({ cacheTime: 0 });
    ok++;
    if (last !== "ok") log(`read OK (block ${n})`);
    last = "ok";
  } catch (e) {
    fail++;
    const m = (e as Error).message.split("\n")[0].slice(0, 90);
    if (last !== m) log(`read FAILED: ${m}`);
    last = m;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
log(`end: ${ok} ok, ${fail} failed, last state: ${last}`);
// A fresh process proves the node is healthy; here a direct socket proves it too.
const probe = new WebSocket(UPSTREAM);
probe.on("open", () => { log("control: a brand-new socket to the same node connects fine"); process.exit(0); });
probe.on("error", (e) => { log("control: node unreachable " + e.message); process.exit(1); });
