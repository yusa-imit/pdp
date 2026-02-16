import type { AppContext, CronJob } from "../types";

export function buildClaudeArgs(job: CronJob): string[] {
  const args = [
    "claude",
    "-p",
    "--output-format", "text",
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

export async function runJob(ctx: AppContext, job: CronJob) {
  if (job.isRunning) {
    console.log(`[SKIP] Job "${job.name}" (id=${job.id}) is already running, skipping`);
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

    const stdoutReader = (async () => {
      for await (const chunk of proc.stdout) {
        logSink.write(chunk);
      }
    })();

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
    logSink.end();
  } catch (err) {
    error = String(err);
    console.error(`  [ERROR] ${error}`);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status = error ? "failed" : exitCode === 0 ? "success" : "failed";

  await ctx.db.run(
    `UPDATE runs SET finished_at = ?, exit_code = ?, duration_ms = ?, error = ?, status = ? WHERE id = ?`,
    finishedAt.toISOString(), exitCode, durationMs, error, status, runId
  );

  job.isRunning = false;
  console.log(`[DONE] Job "${job.name}" (id=${job.id}) run=${runId} status=${status} duration=${durationMs}ms`);
}
