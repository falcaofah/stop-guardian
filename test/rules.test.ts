import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, closeLimit, closeSlippageBps, invalidLevels, liquidationGap, parseCommand, ruleApplies, triggered, type Position } from "../src/rules.ts";

const long: Position = { market: "ETH", side: "long", size: 1, entry: 2450 };

test("a long stops below and takes profit above", () => {
  const rule = { sl: 2425, tp: 2510 };
  assert.equal(triggered("long", 2450, rule), null);
  assert.equal(triggered("long", 2425, rule), "sl");
  assert.equal(triggered("long", 2300, rule), "sl");
  assert.equal(triggered("long", 2510, rule), "tp");
});

test("a short is the mirror", () => {
  const rule = { sl: 2510, tp: 2425 };
  assert.equal(triggered("short", 2450, rule), null);
  assert.equal(triggered("short", 2510, rule), "sl");
  assert.equal(triggered("short", 2425, rule), "tp");
});

test("the stop wins when both levels are crossed", () => {
  assert.equal(triggered("long", 100, { sl: 200, tp: 50 }), "sl");
});

test("levels on the wrong side of the mark are refused", () => {
  assert.equal(invalidLevels("long", 2450, { sl: 2425, tp: 2510 }), null);
  assert.match(invalidLevels("long", 2450, { sl: 2460 })!, /below/);
  assert.match(invalidLevels("long", 2450, { tp: 2440 })!, /above/);
  assert.match(invalidLevels("short", 2450, { sl: 2440 })!, /above/);
  assert.match(invalidLevels("short", 2450, { tp: 2460 })!, /below/);
  assert.match(invalidLevels("long", 2450, {})!, /give/);
  assert.match(invalidLevels("long", 2450, { sl: -1 })!, /positive/);
});

test("a rule does not follow a flipped position", () => {
  const rule = { market: "ETH", side: "short" as const, sl: 2500 };
  assert.equal(ruleApplies(rule, long), false);
  assert.equal(classify(long, rule, 0), "unprotected");
});

test("protection is classified, and a take-profit alone is not protection", () => {
  assert.equal(classify(long, undefined, 0), "unprotected");
  assert.equal(classify(long, undefined, 1), "onchain");
  assert.equal(classify(long, { market: "ETH", side: "long", tp: 2510 }, 0), "unprotected");
  assert.equal(classify(long, { market: "ETH", side: "long", sl: 2425 }, 0), "guarded");
});

test("liquidation gap shrinks towards the liquidation price on both sides", () => {
  assert.equal(liquidationGap("long", 100, 90), 0.1);
  assert.equal(liquidationGap("short", 100, 110), 0.1);
  assert.ok(liquidationGap("long", 100, 110) < 0);
});

test("closing widens slippage each round and crosses the book the right way", () => {
  assert.equal(closeSlippageBps(0), 30);
  assert.equal(closeSlippageBps(3), 120);
  assert.ok(closeLimit("long", 100, 30) < 100);
  assert.ok(closeLimit("short", 100, 30) > 100);
});

test("commands parse, including the group form and thousands separators", () => {
  assert.deepEqual(parseCommand("/sl eth 2,425"), { kind: "arm", market: "ETH", level: "sl", price: 2425 });
  assert.deepEqual(parseCommand("/tp@MyBot ETH-PERP 2510"), { kind: "arm", market: "ETH", level: "tp", price: 2510 });
  assert.deepEqual(parseCommand("/clear sol"), { kind: "clear", market: "SOL" });
  assert.deepEqual(parseCommand("/status"), { kind: "status" });
  assert.equal(parseCommand("hello"), null);
  assert.equal((parseCommand("/sl ETH") as { kind: string }).kind, "error");
  assert.equal((parseCommand("/nope") as { kind: string }).kind, "error");
});
