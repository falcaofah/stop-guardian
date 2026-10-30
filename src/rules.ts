// The decisions, with no I/O, so every one of them is unit-tested.

export type Side = "long" | "short";
export type Protection = "onchain" | "guarded" | "unprotected";

export interface Rule {
  /** Base symbol, e.g. "ETH". */
  market: string;
  /** The position side the rule was armed for. A flip must not inherit it. */
  side: Side;
  sl?: number;
  tp?: number;
}

export interface Position {
  market: string;
  side: Side;
  size: number;
  entry: number;
  mark?: number;
  pnl?: number;
  liquidation?: number;
}

/** Why these levels cannot be armed right now, or null when they can. */
export function invalidLevels(side: Side, mark: number, levels: { sl?: number; tp?: number }): string | null {
  const { sl, tp } = levels;
  if (sl === undefined && tp === undefined) return "give a stop-loss or a take-profit";
  for (const v of [sl, tp]) if (v !== undefined && !(Number.isFinite(v) && v > 0)) return "levels must be positive numbers";
  if (sl !== undefined && (side === "long" ? sl >= mark : sl <= mark)) {
    return `a ${side} stop-loss must be ${side === "long" ? "below" : "above"} the mark (${mark})`;
  }
  if (tp !== undefined && (side === "long" ? tp <= mark : tp >= mark)) {
    return `a ${side} take-profit must be ${side === "long" ? "above" : "below"} the mark (${mark})`;
  }
  return null;
}

/** Which level the mark has crossed. The stop wins if both are somehow crossed. */
export function triggered(side: Side, mark: number, rule: Pick<Rule, "sl" | "tp">): "sl" | "tp" | null {
  const { sl, tp } = rule;
  if (side === "long") {
    if (sl !== undefined && mark <= sl) return "sl";
    if (tp !== undefined && mark >= tp) return "tp";
  } else {
    if (sl !== undefined && mark >= sl) return "sl";
    if (tp !== undefined && mark <= tp) return "tp";
  }
  return null;
}

/** A rule only applies to the position it was armed for. */
export function ruleApplies(rule: Rule | undefined, pos: Position): rule is Rule {
  return rule !== undefined && rule.market === pos.market && rule.side === pos.side;
}

export function classify(pos: Position, rule: Rule | undefined, onchainStops: number): Protection {
  if (onchainStops > 0) return "onchain";
  return ruleApplies(rule, pos) && rule.sl !== undefined ? "guarded" : "unprotected";
}

/** Share of the mark left before liquidation. Negative once past it. */
export function liquidationGap(side: Side, mark: number, liquidation: number): number {
  return (side === "long" ? mark - liquidation : liquidation - mark) / mark;
}

/** Each closing round accepts more slippage: getting out matters more than the price. */
export function closeSlippageBps(round: number): number {
  return 30 + round * 30;
}

/** Limit price for a closing order: a long sells below the touch, a short buys above it. */
export function closeLimit(side: Side, touch: number, bps: number): number {
  return side === "long" ? touch * (1 - bps / 10_000) : touch * (1 + bps / 10_000);
}

export type Command =
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "clear"; market: string }
  | { kind: "arm"; market: string; level: "sl" | "tp"; price: number };

/** Parses "/sl ETH 2425". Null when the text is not a command at all. */
export function parseCommand(text: string): Command | { kind: "error"; message: string } | null {
  const [head, ...rest] = text.trim().split(/\s+/);
  if (!head?.startsWith("/")) return null;
  const verb = head.slice(1).split("@")[0].toLowerCase();
  const market = rest[0]?.toUpperCase().replace(/-PERP$/, "");
  switch (verb) {
    case "status": return { kind: "status" };
    case "help": case "start": return { kind: "help" };
    case "clear":
      return market ? { kind: "clear", market } : { kind: "error", message: "usage: /clear ETH" };
    case "sl": case "tp": {
      const price = Number(rest[1]?.replace(/,/g, ""));
      if (!market || !Number.isFinite(price) || price <= 0) return { kind: "error", message: `usage: /${verb} ETH 2425` };
      return { kind: "arm", market, level: verb, price };
    }
    default: return { kind: "error", message: `unknown command ${head}. Try /help` };
  }
}
