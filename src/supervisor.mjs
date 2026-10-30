// Keeps the guard running. A crash or a blind-restart comes back with a fresh socket.
import { spawn } from "node:child_process";

const MAX_DELAY_MS = 60_000;
let delay = 2_000;

function start() {
  const began = Date.now();
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { stdio: "inherit" });
  child.on("exit", (code) => {
    if (Date.now() - began > 120_000) delay = 2_000;
    console.error(`guardian exited (${code}); restarting in ${delay / 1000}s`);
    setTimeout(start, delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  });
}
start();
