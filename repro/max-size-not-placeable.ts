// Reproduces: getMaxPerpOrderSize() returns a size the pool rejects with InsufficientMarginForOrder.
// Read-only: eth_call simulations, nothing is sent. Usage: OWNER=0x.. OPERATOR=0x.. npx tsx repro/max-size-not-placeable.ts
// OPERATOR must be a key linked to OWNER (Link a bot). Prices are the touch +/- 30 bps, or 1% off the book for resting orders.
import { createPublicClient, defineChain, http, parseAbi, parseUnits } from "viem";
import { contractErrorsAbi, SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";

const OWNER = process.env.OWNER as `0x${string}`;
const OPERATOR = process.env.OPERATOR as `0x${string}`;
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const RPC = "https://api.hideki2.infra.testnet.somnia.network";
const chain = defineChain({ id: 50383, name: "hideki", nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC], webSocket: ["wss://api.hideki2.infra.testnet.somnia.network/ws"] } } });
const sdk = new SomniaMarkets({ indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql", chain, wsRpcUrl: chain.rpcUrls.default.webSocket[0], addresses: SOMNIA_TESTNET_ADDRESSES, account: OWNER });
const pc = createPublicClient({ chain, transport: http(RPC) });
const ABI = [...parseAbi(["function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)"]), ...(contractErrorsAbi as any)] as const;
const LIMIT = 0, MARKET = Number(process.env.MARKET_TYPE ?? 2);
const PCTS = [100n, 99n, 98n, 97n, 95n, 90n];
const exp = BigInt(Math.floor(Date.now() / 1000) + 86400) * 1_000_000_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const why = (e: unknown) => String((e as Error).message).match(/Error: (\w+)/)?.[1] ?? String((e as Error).message).split("\n")[0].slice(0, 40);

const all = Object.values(await sdk.loadMarkets(true)).filter((m: any) => m.type === "swap" && m.active) as any[];
const pick = all.filter((m) => /^(BTC|ETH|SOL|XRP|HYPE|DOGE)\//.test(m.symbol));
const tally: Record<string, Record<string, { ok: number; total: number; errs: Set<string> }>> = { taker: {}, resting: {} };
const note = (k: string, p: bigint, r: string) => {
  const t = (tally[k][String(p)] ??= { ok: 0, total: 0, errs: new Set() });
  t.total++;
  if (r === "ok") t.ok++; else t.errs.add(r);
};
console.log(`markets: ${pick.map((m) => m.symbol.split("/")[0]).join(", ")} · ${ROUNDS} rounds · long and short`);
for (let round = 0; round < ROUNDS; round++) for (const m of pick) for (const long of [true, false]) {
  const info = m.info;
  const book = await sdk.fetchOrderBook(m.symbol, 1);
  const touch = long ? book.asks[0]?.[0] : book.bids[0]?.[0];
  if (!touch) continue;
  for (const [kind, bps, type] of [["taker", long ? 30 : -30, MARKET], ["resting", long ? -100 : 100, LIMIT]] as const) {
    const raw = parseUnits((touch * (1 + bps / 10_000)).toFixed(18), 18);
    const price = (raw / BigInt(info.tickSize)) * BigInt(info.tickSize);
    // SIZE_AT_TOUCH=1 follows the kit's flow: size at the touch, then place at the touch plus slippage.
    const sizedAt = process.env.SIZE_AT_TOUCH && kind === "taker" ? (parseUnits(touch.toFixed(18), 18) / BigInt(info.tickSize)) * BigInt(info.tickSize) : price;
    const max = await sdk.client.getMaxPerpOrderSize({ pool: info.poolAddress, marginBank: info.marginBank, account: OWNER, isBid: long, price: sizedAt, autoPull: false });
    if (!max.placeable) continue;
    const lot = BigInt(info.lotSize ?? 1);
    for (const pct of PCTS) {
      const quantity = ((max.maxQuantity * pct) / 100n / lot) * lot;
      try {
        await pc.simulateContract({ address: info.poolAddress, abi: ABI as any, functionName: "placeOrderFor", account: OPERATOR, gas: 60_000_000n,
          args: [OWNER, long, 0n, price, quantity, exp, type, 0, ZERO, 0n] });
        note(kind, pct, "ok");
      } catch (e) { note(kind, pct, why(e)); }
    }
  }
}
for (const k of ["taker", "resting"]) {
  console.log(`\n${k} orders`);
  for (const p of PCTS) { const t = tally[k][String(p)]; if (t) console.log(`  ${String(p).padStart(3)}% of max: ${t.ok}/${t.total} accepted  ${[...t.errs].join(", ")}`); }
}
process.exit(0);
