// Everything that talks to Somnia. Reads go through the SDK; closes go through the linked key's placeOrderFor.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { contractErrorsAbi, ORDER_TYPE, SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { closeLimit, closeSlippageBps, type Position, type Side } from "./rules.ts";

export interface ChainConfig {
  owner: `0x${string}`;
  privateKey?: `0x${string}`;
  dryRun: boolean;
  rpcUrl: string;
  wsUrl: string;
  indexerUrl: string;
  chainId: number;
  evidenceFile: string;
}

const ORDER_ABI = [
  ...parseAbi(["function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)"]),
  ...(contractErrorsAbi as any),
] as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const MAX_ROUNDS = 4;
const MIN_GAS = 10_000_000n;
const MAX_GAS = 80_000_000n;
const TRANSIENT = /RPC Request failed|took too long|timed? ?out|fetch failed|ECONNRESET|ETIMEDOUT|socket|HTTP request failed|status: 5\d\d|429|Too Many Requests/i;

/** Human number to raw units. Fixing fewer places than the grid needs round-trips exactly. */
function toRaw(human: number, decimals: number): bigint {
  const [i = "0", f = ""] = human.toFixed(Math.min(decimals, 9)).split(".");
  return BigInt(i + f.padEnd(decimals, "0").slice(0, decimals));
}
const onGrid = (v: bigint, step: string) => (BigInt(step) > 0n ? (v / BigInt(step)) * BigInt(step) : v);

export interface CloseResult {
  closed: number;
  hashes: string[];
  dryRun: boolean;
}

export class Chain {
  readonly sdk: SomniaMarkets;
  private readonly key;
  private readonly pc;
  private readonly wallet;

  constructor(private readonly cfg: ChainConfig) {
    const chain = defineChain({
      id: cfg.chainId,
      name: `somnia-${cfg.chainId}`,
      nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
      rpcUrls: { default: { http: [cfg.rpcUrl], webSocket: [cfg.wsUrl] } },
    });
    this.sdk = new SomniaMarkets({ indexerUrl: cfg.indexerUrl, chain, wsRpcUrl: cfg.wsUrl, addresses: SOMNIA_TESTNET_ADDRESSES, account: cfg.owner });
    this.pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
    this.key = cfg.privateKey ? privateKeyToAccount(cfg.privateKey) : undefined;
    this.wallet = this.key ? createWalletClient({ account: this.key, chain, transport: http(cfg.rpcUrl) }) : undefined;
  }

  private async market(base: string): Promise<any> {
    const all = Object.values(await this.sdk.loadMarkets(false)) as any[];
    const m = all.find((x) => x.type === "swap" && x.symbol.split("/")[0] === base);
    if (!m) throw new Error(`no ${base} perp market`);
    return m;
  }

  async positions(): Promise<Position[]> {
    const rows = await this.sdk.fetchPositions();
    return rows
      .filter((p) => p.contracts)
      .map((p) => ({
        market: p.symbol.split("/")[0],
        side: p.side as Side,
        size: p.contracts as number,
        entry: p.entryPrice as number,
        mark: p.markPrice ?? undefined,
        pnl: p.unrealizedPnl ?? undefined,
        liquidation: p.liquidationPrice ?? undefined,
      }));
  }

  /** The live mark, or undefined while the market is un-priceable. Read errors throw: the loop counts them. */
  async mark(base: string): Promise<number | undefined> {
    const m = await this.market(base);
    const s: any = await this.sdk.client.getPerpHealthSnapshot(m.info.poolAddress);
    if (!s.priceable) return undefined;
    const raw = Number(s.markPrice);
    return raw > 0 ? raw / 1e18 : undefined;
  }

  /** Pending on-chain stops that would close this position. */
  async onchainStops(pos: Position): Promise<number> {
    const m = await this.market(pos.market);
    const rows: any[] = await (this.sdk.client as any).listPerpStopOrders({ account: this.cfg.owner.toLowerCase(), pool: m.info.poolAddress, status: ["PENDING"] });
    return rows.filter((s) => Boolean(s.isBid) === (pos.side === "short")).length;
  }

  /** Closes the whole position. Re-reads it each round, so a retry can never open the other way. */
  async close(base: string, reason: string): Promise<CloseResult> {
    const m = await this.market(base);
    const { info } = m;
    const hashes: string[] = [];
    let closed = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const pos = (await this.positions()).find((p) => p.market === base);
      if (!pos) break;
      const book = await this.sdk.fetchOrderBook(m.symbol, 1);
      const touch = pos.side === "long" ? book.bids[0]?.[0] : book.asks[0]?.[0];
      if (touch === undefined) throw new Error(`empty book on ${base}`);
      const price = onGrid(toRaw(closeLimit(pos.side, touch, closeSlippageBps(round)), 18), info.tickSize);
      const quantity = onGrid(toRaw(pos.size, info.baseDecimals), info.lotSize);
      if (quantity === 0n) break;
      if (this.cfg.dryRun || !this.key || !this.wallet) {
        console.log(`[dry-run] would close ${pos.side} ${pos.size} ${base} @ limit ${formatUnits(price, 18)} (${reason})`);
        return { closed: pos.size, hashes, dryRun: true };
      }
      const call = {
        address: info.poolAddress, abi: ORDER_ABI as any, functionName: "placeOrderFor", account: this.key,
        args: [this.cfg.owner, pos.side === "short", 0n, price, quantity, BigInt(Math.floor(Date.now() / 1000) + 3600) * 1_000_000_000n, ORDER_TYPE.MARKET, 0, ZERO, 0n],
      } as const;
      try {
        // Gas is estimated: an order sweeping several levels can outgrow the SDK's fixed 10M.
        let gas = ((await this.pc.estimateContractGas(call as any)) * 13n) / 10n;
        gas = gas < MIN_GAS ? MIN_GAS : gas > MAX_GAS ? MAX_GAS : gas;
        const { request } = await this.pc.simulateContract({ ...(call as any), gas });
        const hash = await this.wallet.writeContract(request as never);
        const receipt = await this.pc.waitForTransactionReceipt({ hash });
        hashes.push(hash);
        this.evidence({ at: new Date().toISOString(), market: base, side: pos.side, size: pos.size, reason, hash, status: receipt.status });
        if (receipt.status !== "success") throw new Error(`close reverted on-chain (${hash})`);
        const left = (await this.positions()).find((p) => p.market === base)?.size ?? 0;
        closed += pos.size - left;
        if (left === 0) break;
      } catch (e) {
        const message = (e as Error).message;
        const noFill = message.includes("ImmediateOrCancelNoFill");
        if (round === MAX_ROUNDS - 1 || !(noFill || TRANSIENT.test(message))) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    return { closed, hashes, dryRun: false };
  }

  private evidence(row: object): void {
    mkdirSync(dirname(this.cfg.evidenceFile), { recursive: true });
    appendFileSync(this.cfg.evidenceFile, JSON.stringify(row) + "\n");
  }
}
