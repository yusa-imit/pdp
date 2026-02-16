import { mkdir } from "node:fs/promises";
import { init } from "./db";
import { loadJobs } from "./services/scheduler";
import { startServer } from "./server";

const LOGS_DIR = process.env.LOGS_DIR || "./data/logs";

// --- Bootstrap ---

await mkdir(LOGS_DIR, { recursive: true });
await init();
await loadJobs();

const server = startServer();

console.log(`Cron server running on http://localhost:${server.port}`);
console.log(`Database: ${process.env.DB_PATH || "./data/cron.db"}`);
console.log(`Logs: ${LOGS_DIR}`);
