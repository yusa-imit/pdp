import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface LogRotateOptions {
  maxAgeDays: number; // delete logs older than this
  maxFiles: number; // keep at most this many (newest survive)
  maxTotalMB: number; // keep total size under this budget (newest survive)
}

// Prune per-run job logs so data/logs/ can't grow unbounded. Unbounded growth
// here filled the disk (ENOSPC) and triggered the 2026-07 outage, so we enforce
// three independent caps — age, file count, and total bytes — always keeping the
// newest logs. Returns the number of files deleted. Never throws: a failure to
// prune must not take down the scheduler.
export function pruneLogs(logsDir: string, opts: LogRotateOptions): number {
  let entries: { path: string; mtimeMs: number; size: number }[];
  try {
    entries = readdirSync(logsDir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => {
        const path = join(logsDir, f);
        const st = statSync(path);
        return { path, mtimeMs: st.mtimeMs, size: st.size };
      });
  } catch {
    return 0; // dir missing/unreadable — nothing to prune
  }

  const now = Date.now();
  const maxAgeMs = opts.maxAgeDays * 24 * 60 * 60 * 1000;
  const budgetBytes = opts.maxTotalMB * 1024 * 1024;
  const toDelete = new Set<string>();

  // Age cap.
  for (const e of entries) {
    if (now - e.mtimeMs > maxAgeMs) toDelete.add(e.path);
  }

  // Count + size caps, applied to whatever the age cap left, newest first.
  const survivors = entries
    .filter((e) => !toDelete.has(e.path))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  let cumBytes = 0;
  survivors.forEach((e, i) => {
    cumBytes += e.size;
    if (i >= opts.maxFiles || cumBytes > budgetBytes) toDelete.add(e.path);
  });

  let deleted = 0;
  for (const path of toDelete) {
    try {
      unlinkSync(path);
      deleted++;
    } catch {
      /* file already gone / racing a write — ignore */
    }
  }
  return deleted;
}
