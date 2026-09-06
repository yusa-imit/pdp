import { mkdir } from "node:fs/promises";
import { ensureDuckdbBinding } from "./lib/duckdb-binding";
import { pruneLogs } from "./services/logrotate";
import { loadJobs } from "./services/scheduler";
import { startServer } from "./server";
import type { AppContext } from "./types";

const DB_PATH = process.env.DB_PATH || "./data/cron.db";
const LOGS_DIR = process.env.LOGS_DIR || "./data/logs";
const MAX_PARALLEL_JOBS = Number(process.env.MAX_PARALLEL_JOBS) || 5;
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 14;
const LOG_MAX_FILES = Number(process.env.LOG_MAX_FILES) || 1000;
const LOG_MAX_TOTAL_MB = Number(process.env.LOG_MAX_TOTAL_MB) || 2000;
const LOG_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h

// --- Bootstrap ---

// Self-heal the DuckDB native binding BEFORE anything imports `duckdb` (the DB
// module is imported dynamically below for exactly this reason).
ensureDuckdbBinding();

await mkdir(LOGS_DIR, { recursive: true });

// Keep data/logs/ bounded (age + count + total size) so it can't fill the disk.
function runLogPrune(): void {
  const n = pruneLogs(LOGS_DIR, {
    maxAgeDays: LOG_RETENTION_DAYS,
    maxFiles: LOG_MAX_FILES,
    maxTotalMB: LOG_MAX_TOTAL_MB,
  });
  if (n > 0) console.log(`[logrotate] pruned ${n} old log file(s) from ${LOGS_DIR}`);
}
runLogPrune();
setInterval(runLogPrune, LOG_PRUNE_INTERVAL_MS).unref?.();

// Import the DB layer lazily so ensureDuckdbBinding() has already run.
const { createDb } = await import("./db");
const db = createDb(DB_PATH);
await db.init();

// Graceful shutdown: closing DuckDB checkpoints the WAL, so a restart never has to replay it.
let shuttingDown = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${sig}: checkpointing and closing the database`);
    try { await db.checkpoint(); await db.close(); } catch (e) { console.error(`[shutdown] ${String(e)}`); }
    process.exit(0);
  });
}

const ctx: AppContext = {
  db,
  jobs: new Map(),
  logsDir: LOGS_DIR,
  maxParallelJobs: MAX_PARALLEL_JOBS,
};

await loadJobs(ctx);

const server = startServer(ctx);

console.log(`Cron server running on http://localhost:${server.port}`);
console.log(`Database: ${DB_PATH}`);
console.log(`Logs: ${LOGS_DIR} (retention: ${LOG_RETENTION_DAYS}d / ${LOG_MAX_FILES} files / ${LOG_MAX_TOTAL_MB}MB)`);
