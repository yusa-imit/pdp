import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { FileSink } from "bun";
import type { AppContext, CronJob, ClaudeJsonResult } from "../types";
import { getAllJobs } from "./scheduler";

// How long to wait after a SIGTERM to the job's process group before
// escalating to SIGKILL, and how long to wait for the stdout/stderr readers
// to drain after a kill before giving up on them. Kept small relative to
// job timeouts so a wedged child can't hang runJob (and the parallel-job
// slot it occupies) indefinitely.
const GROUP_KILL_GRACE_MS = 10_000;
const READER_DRAIN_DEADLINE_MS = 15_000;

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | "deadline"> {
  return Promise.race([
    promise,
    new Promise<"deadline">((resolve) => setTimeout(() => resolve("deadline"), ms)),
  ]);
}

export function buildClaudeArgs(job: CronJob): string[] {
  const args = [
    "claude",
    "-p",
    "--output-format", "json",
    "--model", job.model,
    "--permission-mode", job.permissionMode,
    "--verbose",
  ];

  if (job.maxBudget) {
    args.push("--max-budget-usd", String(job.maxBudget));
  }

  if (job.allowedTools.length > 0) {
    args.push("--allowedTools", ...job.allowedTools);
  }

  if (job.appendSystemPrompt) {
    args.push("--append-system-prompt", job.appendSystemPrompt);
  }

  args.push(...(job.extraArgs ?? []));

  args.push(job.prompt);
  return args;
}

// Strip Bun's node→bun shim from the environment handed to spawned jobs.
//
// The cron server runs under `bun run`, and Bun injects a temp shim dir
// (/private/tmp/bun-node-*) into PATH plus a NODE env var, both pointing `node`
// at the bun binary. Inherited by a Claude job, this makes every downstream
// `node` (pnpm → vitest → tinypool fork workers) run under Bun's JavaScriptCore
// engine. JSC ignores V8's `--max-old-space-size`, so test-worker heaps grow
// unbounded — a single Vitest fork was measured at a 35GB physical footprint,
// driving the host deep into swap. Removing the shim makes children resolve a
// real Node, where the heap cap is enforced.
export function cleanJobEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out = { ...env };
  // The bun shim is the only `node` on PATH, so we must substitute a real Node
  // (vite-plus ships one) before stripping the shim — otherwise downstream
  // `node`/pnpm/vitest resolve to nothing and the test run dies.
  const realNodeDir = `${homedir()}/.vite-plus/bin`;
  const realNode = `${realNodeDir}/node`;
  const hasRealNode = existsSync(realNode);

  if (out.PATH) {
    const parts = out.PATH.split(":").filter((p) => !p.includes("/bun-node-"));
    if (hasRealNode && !parts.includes(realNodeDir)) {
      parts.unshift(realNodeDir);
    }
    out.PATH = parts.join(":");
  }
  if (hasRealNode) {
    out.NODE = realNode;
  } else {
    delete out.NODE;
  }
  // Force pnpm/npm to recompute the node binary from the cleaned PATH instead of
  // reusing the inherited bun execpath.
  delete out.npm_node_execpath;
  return out;
}

export function parseClaudeJson(stdout: string): ClaudeJsonResult | null {
  // claude --output-format json may emit a JSON array or JSONL stream
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    // JSON array: find the result entry
    if (Array.isArray(parsed)) {
      const result = parsed.find((e: any) => e.type === "result");
      return result ? (result as ClaudeJsonResult) : null;
    }
    // Single object with type=result
    if (parsed.type === "result") return parsed as ClaudeJsonResult;
  } catch { /* not a single JSON blob, try JSONL */ }

  // JSONL: scan lines from end for type=result
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed.type === "result") return parsed as ClaudeJsonResult;
    } catch { /* skip */ }
  }
  return null;
}

export async function runJob(ctx: AppContext, job: CronJob) {
  if (job.isRunning) {
    console.log(`[SKIP] Job "${job.name}" (id=${job.id}) is already running, skipping`);
    return;
  }

  // Check parallel job limit
  const runningCount = getAllJobs(ctx).filter((j) => j.isRunning).length;
  if (runningCount >= ctx.maxParallelJobs) {
    const reason = `Parallel limit reached (${runningCount}/${ctx.maxParallelJobs})`;
    console.log(`[SKIP] Job "${job.name}" (id=${job.id}) — ${reason}`);
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, finished_at, duration_ms, status, error) VALUES (?, ?, ?, 0, 'skipped', ?)",
      job.id, new Date().toISOString(), new Date().toISOString(), reason
    );
    return;
  }

  // Check daily budget
  if (job.dailyBudgetUsd != null) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const spentRow = await ctx.db.get<{ total: number }>(
      "SELECT COALESCE(SUM(cost_usd),0) as total FROM runs WHERE job_id = ? AND started_at >= ?",
      job.id, todayStart.toISOString()
    );
    const spent = spentRow?.total ?? 0;
    if (spent >= job.dailyBudgetUsd) {
      const reason = "daily budget reached";
      console.log(`[SKIP] Job "${job.name}" (id=${job.id}) — ${reason} ($${spent.toFixed(4)} >= $${job.dailyBudgetUsd})`);
      await ctx.db.run(
        "INSERT INTO runs (job_id, started_at, finished_at, duration_ms, status, error) VALUES (?, ?, ?, 0, 'skipped', ?)",
        job.id, new Date().toISOString(), new Date().toISOString(), reason
      );
      return;
    }
  }

  job.isRunning = true;
  const startedAt = new Date();
  const timestamp = startedAt.toISOString().replace(/[:.]/g, "-");
  // Ensure the logs directory exists on every run, not just at server startup.
  // The dir can be removed out from under a long-lived process (e.g. manual
  // disk cleanup after an ENOSPC). If it's missing, Bun.file(...).writer()
  // throws an opaque `ENOENT ... open ''` and the job dies in a few ms before
  // Claude is ever spawned. Recreating it here keeps a deleted dir from
  // silently breaking every job until the next restart.
  mkdirSync(ctx.logsDir, { recursive: true });
  const logFile = `${ctx.logsDir}/job-${job.id}-${timestamp}.log`;

  await ctx.db.run(
    "INSERT INTO runs (job_id, started_at, log_file, status) VALUES (?, ?, ?, 'running')",
    job.id, startedAt.toISOString(), logFile
  );
  const runRow = await ctx.db.get<{ id: number }>(
    "SELECT max(id) as id FROM runs WHERE job_id = ?", job.id
  );
  const runId = runRow!.id;

  console.log(`[START] Job "${job.name}" (id=${job.id}) run=${runId}`);
  console.log(`  prompt: ${job.prompt.slice(0, 100)}...`);
  console.log(`  cwd: ${job.cwd}`);
  console.log(`  log: ${logFile}`);

  let exitCode: number | null = null;
  let error: string | null = null;
  let costUsd: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  // Declared outside the try so the catch branch can always close it, even
  // if something throws after it's opened but before the happy-path close.
  let logSink: FileSink | undefined;

  try {
    const args = buildClaudeArgs(job);
    logSink = Bun.file(logFile).writer();

    const header = [
      `=== Job: ${job.name} (id=${job.id}) run=${runId} ===`,
      `Started: ${startedAt.toISOString()}`,
      `Prompt: ${job.prompt}`,
      `Model: ${job.model}`,
      `CWD: ${job.cwd}`,
      `Command: ${args.join(" ")}`,
      "=".repeat(60),
      "",
    ].join("\n");
    logSink.write(header);

    // Run in its own process group (detached) so a timeout can kill every
    // descendant it spawned (npm scripts, test runners, etc.), not just the
    // immediate `claude` process.
    const proc = Bun.spawn(args, {
      cwd: job.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: cleanJobEnv(process.env),
      detached: true,
    });

    // Buffer stdout (JSON output comes at process exit)
    const stdoutChunks: Uint8Array[] = [];
    const stdoutReader = (async () => {
      for await (const chunk of proc.stdout) {
        stdoutChunks.push(new Uint8Array(chunk));
      }
    })();

    // Stream stderr to log in real-time (--verbose progress goes here)
    const stderrReader = (async () => {
      for await (const chunk of proc.stderr) {
        logSink!.write(new TextEncoder().encode(`[stderr] `));
        logSink!.write(chunk);
      }
    })();

    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), job.timeoutMs)
    );

    const result = await Promise.race([
      proc.exited.then((code) => ({ type: "done" as const, code })),
      timeout.then(() => ({ type: "timeout" as const, code: null })),
    ]);

    if (result.type === "timeout") {
      error = `Timed out after ${job.timeoutMs}ms`;
      logSink.write(`\n[TIMEOUT] ${error}\n`);
      console.log(`  [TIMEOUT] ${error}`);

      // Signal the whole process group, not just `proc` itself — `detached`
      // made it the group leader, so `-pid` reaches every descendant.
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch { /* group may already be gone */ }

      const termResult = await withDeadline(proc.exited, GROUP_KILL_GRACE_MS);
      if (termResult === "deadline") {
        console.log(`  [TIMEOUT] process group ${proc.pid} still alive after SIGTERM, sending SIGKILL`);
        try {
          process.kill(-proc.pid, "SIGKILL");
        } catch { /* group may already be gone */ }
        await withDeadline(proc.exited, GROUP_KILL_GRACE_MS);
      }
    } else {
      exitCode = result.code;
    }

    // Guard against a wedged reader (e.g. a grandchild that inherited the
    // pipe fd and is still holding it open post-kill) so a bad job can't
    // hang runJob — and the parallel-job slot it holds — forever.
    const readersResult = await withDeadline(
      Promise.allSettled([stdoutReader, stderrReader]),
      READER_DRAIN_DEADLINE_MS
    );
    if (readersResult === "deadline") {
      logSink.write(`\n[WARN] stdout/stderr did not drain within ${READER_DRAIN_DEADLINE_MS}ms, giving up\n`);
      console.log(`  [WARN] stdout/stderr readers for run=${runId} did not drain in time`);
    }

    // Parse JSON stdout
    const stdoutBuf = Buffer.concat(stdoutChunks);
    const stdoutStr = new TextDecoder().decode(stdoutBuf);
    const claudeResult = parseClaudeJson(stdoutStr);

    if (claudeResult) {
      costUsd = claudeResult.total_cost_usd ?? null;
      inputTokens = claudeResult.usage?.input_tokens ?? null;
      outputTokens = claudeResult.usage?.output_tokens ?? null;
      // Write the result text to the log
      logSink.write(`\n${"=".repeat(60)}\n[RESULT]\n${claudeResult.result}\n`);
      console.log(`  cost=$${costUsd?.toFixed(4)} in=${inputTokens} out=${outputTokens}`);
    } else if (stdoutStr.trim()) {
      // Fallback: write raw stdout if JSON parsing failed
      logSink.write(`\n${"=".repeat(60)}\n[RAW OUTPUT]\n${stdoutStr}\n`);
    }

    logSink.end();
  } catch (err) {
    error = String(err);
    console.error(`  [ERROR] ${error}`);
    // Make sure the log file handle isn't leaked when something throws
    // before the happy-path logSink.end() above runs.
    try {
      logSink?.end();
    } catch { /* already closed or never opened */ }
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status = error ? "failed" : exitCode === 0 ? "success" : "failed";

  await ctx.db.run(
    `UPDATE runs SET finished_at = ?, exit_code = ?, duration_ms = ?, error = ?, status = ?, cost_usd = ?, input_tokens = ?, output_tokens = ? WHERE id = ?`,
    finishedAt.toISOString(), exitCode, durationMs, error, status, costUsd, inputTokens, outputTokens, runId
  );

  job.isRunning = false;
  console.log(`[DONE] Job "${job.name}" (id=${job.id}) run=${runId} status=${status} duration=${durationMs}ms`);
}
