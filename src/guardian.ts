// One pass of the guard, and the commands. The loop and restart policy live in index.ts.
import type { Chain } from "./chain.ts";
import { classify, invalidLevels, liquidationGap, parseCommand, ruleApplies, triggered, type Position, type Protection } from "./rules.ts";
import type { RuleStore } from "./store.ts";
import type { Telegram } from "./telegram.ts";

const REMIND_MS = 6 * 3600_000;
const NEAR_LIQUIDATION = 0.02;

const HELP = `Stop Guardian
/status: positions and how each is protected
/sl ETH 2425: close ETH if the mark reaches 2425
/tp ETH 2510: close ETH if the mark reaches 2510
/clear ETH: remove the levels`;

const ICON: Record<Protection, string> = { onchain: "🛡", guarded: "👁", unprotected: "⚠️" };
const WORD: Record<Protection, string> = { onchain: "on-chain stop", guarded: "guarded", unprotected: "NO STOP" };
const usd = (v?: number) => (v === undefined ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`);

export class Guardian {
  private warned = new Map<string, number>();
  private liqWarned = new Set<string>();

  constructor(private readonly chain: Chain, private readonly rules: RuleStore, private readonly tg: Telegram) {}

  /** Throws on a failed chain read, so the loop can count how long it has been blind. */
  async tick(now = Date.now()): Promise<void> {
    const positions = await this.chain.positions();
    const live = new Set(positions.map((p) => `${p.market}:${p.side}`));

    // Levels of a position that is gone: closed by hand, by a stop or by liquidation.
    for (const r of this.rules.all()) {
      if (!live.has(`${r.market}:${r.side}`)) {
        this.rules.delete(r.market);
        await this.tg.send(`${r.market} ${r.side} is no longer open. Levels removed.`);
      }
    }
    for (const k of this.warned.keys()) if (!live.has(k)) this.warned.delete(k);
    for (const k of this.liqWarned) if (!live.has(k)) this.liqWarned.delete(k);

    for (const pos of positions) await this.guard(pos, now);
  }

  private async guard(pos: Position, now: number): Promise<void> {
    const key = `${pos.market}:${pos.side}`;
    const mark = await this.chain.mark(pos.market);
    const rule = this.rules.get(pos.market);

    // No mark means no decision: never act on a price we do not have.
    if (mark !== undefined && ruleApplies(rule, pos)) {
      const hit = triggered(pos.side, mark, rule);
      if (hit) return this.fire(pos, hit, mark);
    }

    const state = classify(pos, rule, await this.chain.onchainStops(pos));
    if (state === "unprotected" && now - (this.warned.get(key) ?? 0) > REMIND_MS) {
      this.warned.set(key, now);
      await this.tg.send(`⚠️ ${pos.market} ${pos.side} ${pos.size} has no stop. PnL ${usd(pos.pnl)}.\nSet one: /sl ${pos.market} <price>`);
    }
    if (state !== "unprotected") this.warned.delete(key);

    if (mark !== undefined && pos.liquidation) {
      const near = liquidationGap(pos.side, mark, pos.liquidation) < NEAR_LIQUIDATION;
      if (near && !this.liqWarned.has(key)) {
        this.liqWarned.add(key);
        await this.tg.send(`🚨 ${pos.market} ${pos.side} is within ${NEAR_LIQUIDATION * 100}% of liquidation (${pos.liquidation}). Mark ${mark}.`);
      } else if (!near) {
        this.liqWarned.delete(key);
      }
    }
  }

  private async fire(pos: Position, hit: "sl" | "tp", mark: number): Promise<void> {
    const name = hit === "sl" ? "Stop-loss" : "Take-profit";
    await this.tg.send(`${hit === "sl" ? "🛑" : "🎯"} ${name} hit on ${pos.market} ${pos.side} at mark ${mark}. Closing.`);
    try {
      const r = await this.chain.close(pos.market, hit);
      this.rules.delete(pos.market);
      if (r.dryRun) await this.tg.send(`DRY_RUN: nothing sent. It would close ${r.closed} ${pos.market}. PnL ${usd(pos.pnl)}.`);
      else await this.tg.send(`✅ Closed ${r.closed} ${pos.market}. PnL ${usd(pos.pnl)}.\n${r.hashes.join("\n")}`);
    } catch (e) {
      // Levels stay armed, so the next tick tries again.
      await this.tg.send(`❌ Could not close ${pos.market}: ${(e as Error).message.split("\n")[0].slice(0, 160)}. Retrying.`);
    }
  }

  async command(text: string): Promise<void> {
    const c = parseCommand(text);
    if (!c) return;
    if (c.kind === "error") return this.tg.send(c.message);
    if (c.kind === "help") return this.tg.send(HELP);
    if (c.kind === "status") return this.status();
    if (c.kind === "clear") {
      return this.tg.send(this.rules.delete(c.market) ? `${c.market}: levels removed.` : `${c.market}: no levels set.`);
    }
    const pos = (await this.chain.positions()).find((p) => p.market === c.market);
    if (!pos) return this.tg.send(`No open ${c.market} position.`);
    const mark = await this.chain.mark(c.market);
    if (mark === undefined) return this.tg.send(`${c.market} has no live mark right now. Try again shortly.`);
    const old = this.rules.get(c.market);
    const kept = ruleApplies(old, pos) ? old : { market: c.market, side: pos.side };
    const next = { ...kept, [c.level]: c.price };
    const problem = invalidLevels(pos.side, mark, next);
    if (problem) return this.tg.send(`Not set: ${problem}.`);
    this.rules.set(next);
    await this.tg.send(`${ICON.guarded} ${c.market} ${pos.side}: stop ${next.sl ?? "-"} · target ${next.tp ?? "-"} · mark ${mark}`);
  }

  private async status(): Promise<void> {
    const positions = await this.chain.positions();
    if (!positions.length) return this.tg.send("No open positions.");
    const lines = [];
    for (const p of positions) {
      const rule = this.rules.get(p.market);
      const state = classify(p, rule, await this.chain.onchainStops(p));
      const levels = ruleApplies(rule, p) ? ` · stop ${rule.sl ?? "-"} · target ${rule.tp ?? "-"}` : "";
      lines.push(`${ICON[state]} ${p.market} ${p.side} ${p.size} · PnL ${usd(p.pnl)} · ${WORD[state]}${levels}`);
    }
    await this.tg.send(lines.join("\n"));
  }
}
