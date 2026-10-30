// A tiny .env reader, so the only runtime dependencies are the SDK and viem.
import { existsSync, readFileSync } from "node:fs";

export function config(file = ".env"): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...process.env };
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && out[m[1]] === undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
