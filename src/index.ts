import { mkdir } from "node:fs/promises";
import { createDb } from "./db";
import { loadJobs } from "./services/scheduler";
import { startServer } from "./server";
import type { AppContext } from "./types";

const DB_PATH = process.env.DB_PATH || "./data/cron.db";
const LOGS_DIR = process.env.LOGS_DIR || "./data/logs";

// --- Bootstrap ---

await mkdir(LOGS_DIR, { recursive: true });

const db = createDb(DB_PATH);
await db.init();

const ctx: AppContext = {
  db,
  jobs: new Map(),
  logsDir: LOGS_DIR,
};

await loadJobs(ctx);

const server = startServer(ctx);

console.log(`Cron server running on http://localhost:${server.port}`);
console.log(`Database: ${DB_PATH}`);
console.log(`Logs: ${LOGS_DIR}`);
