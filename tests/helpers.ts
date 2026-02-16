import { createDb } from "../src/db";
import type { AppContext } from "../src/types";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

export async function createTestContext(): Promise<AppContext> {
  const logsDir = await mkdtemp(join(tmpdir(), "cron-test-logs-"));
  const db = createDb(":memory:");
  await db.init();
  return { db, jobs: new Map(), logsDir };
}
