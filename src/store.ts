// Rules survive restarts: a guard that forgets its stops on reboot is worse than none.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Rule } from "./rules.ts";

export class RuleStore {
  private rules = new Map<string, Rule>();

  constructor(private readonly file: string) {
    if (existsSync(file)) for (const r of JSON.parse(readFileSync(file, "utf8")) as Rule[]) this.rules.set(r.market, r);
  }

  get(market: string): Rule | undefined {
    return this.rules.get(market);
  }

  all(): Rule[] {
    return [...this.rules.values()];
  }

  set(rule: Rule): void {
    this.rules.set(rule.market, rule);
    this.save();
  }

  delete(market: string): boolean {
    const had = this.rules.delete(market);
    if (had) this.save();
    return had;
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.all(), null, 2));
    renameSync(tmp, this.file);
  }
}
