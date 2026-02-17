import type { AppContext, CronJob, ClaudeJsonResult } from "../types";
import { getAllJobs } from "./scheduler";
import { shouldSkipForUsage } from "./usage";

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

  args.push(job.prompt);
  return args;
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

  // Check usage threshold before running
  const usageCheck = await shouldSkipForUsage(ctx, job);
  if (usageCheck.skip) {
    console.log(`[SKIP] Job "${job.name}" (id=${job.id}) — ${usageCheck.reason}`);
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, finished_at, duration_ms, status, error) VALUES (?, ?, ?, 0, 'skipped', ?)",
      job.id, new Date().toISOString(), new Date().toISOString(), usageCheck.reason
    );
    return;
  }

  job.isRunning = true;
  const startedAt = new Date();
  const timestamp = startedAt.toISOString().replace(/[:.]/g, "-");
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

  try {
    const args = buildClaudeArgs(job);
    const logSink = Bun.file(logFile).writer();

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

    const proc = Bun.spawn(args, {
      cwd: job.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
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
        logSink.write(new TextEncoder().encode(`[stderr] `));
        logSink.write(chunk);
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
      proc.kill();
      error = `Timed out after ${job.timeoutMs}ms`;
      logSink.write(`\n[TIMEOUT] ${error}\n`);
      console.log(`  [TIMEOUT] ${error}`);
    } else {
      exitCode = result.code;
    }

    await Promise.allSettled([stdoutReader, stderrReader]);

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
