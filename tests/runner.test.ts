import { describe, test, expect, afterEach } from "bun:test";
import { buildClaudeArgs, parseClaudeJson, runJob } from "../src/services/runner";
import { scheduleJob } from "../src/services/scheduler";
import type { AppContext, CronJob } from "../src/types";
import { Cron } from "croner";
import { createTestContext } from "./helpers";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 1,
    name: "test-job",
    expression: "* * * * *",
    prompt: "do something",
    cwd: "/tmp",
    model: "sonnet",
    permissionMode: "bypassPermissions",
    maxBudget: null,
    timeoutMs: 600000,
    allowedTools: [],
    appendSystemPrompt: "",
    sessionLimitThreshold: 90,
    dailyBudgetUsd: null,
    blockTokenLimit: null,
    instance: new Cron("* * * * *", { paused: true }, () => {}),
    createdAt: new Date().toISOString(),
    isRunning: false,
    isPaused: false,
    ...overrides,
  };
}

describe("buildClaudeArgs", () => {
  test("builds basic args with json output format", () => {
    const args = buildClaudeArgs(makeJob());
    expect(args).toEqual([
      "claude", "-p",
      "--output-format", "json",
      "--model", "sonnet",
      "--permission-mode", "bypassPermissions",
      "--verbose",
      "do something",
    ]);
  });

  test("includes --max-budget-usd when set", () => {
    const args = buildClaudeArgs(makeJob({ maxBudget: 5 }));
    expect(args).toContain("--max-budget-usd");
    expect(args).toContain("5");
  });

  test("excludes --max-budget-usd when null", () => {
    const args = buildClaudeArgs(makeJob({ maxBudget: null }));
    expect(args).not.toContain("--max-budget-usd");
  });

  test("includes --allowedTools when set", () => {
    const args = buildClaudeArgs(makeJob({ allowedTools: ["Read", "Write"] }));
    expect(args).toContain("--allowedTools");
    expect(args).toContain("Read");
    expect(args).toContain("Write");
  });

  test("includes --append-system-prompt when set", () => {
    const args = buildClaudeArgs(makeJob({ appendSystemPrompt: "extra instructions" }));
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("extra instructions");
  });

  test("prompt is always the last arg", () => {
    const args = buildClaudeArgs(makeJob({ prompt: "my prompt" }));
    expect(args[args.length - 1]).toBe("my prompt");
  });

  test("passes extraArgs through verbatim immediately before the prompt", () => {
    const args = buildClaudeArgs(makeJob({
      prompt: "my prompt",
      extraArgs: ["--add-dir", "/tmp/extra", "--debug"],
    }));
    expect(args[args.length - 1]).toBe("my prompt");
    expect(args.slice(-4, -1)).toEqual(["--add-dir", "/tmp/extra", "--debug"]);
  });

  test("omits extraArgs entirely when undefined", () => {
    const args = buildClaudeArgs(makeJob({ extraArgs: undefined }));
    expect(args[args.length - 1]).toBe("do something");
  });
});

describe("parseClaudeJson", () => {
  test("parses result from JSONL stream", () => {
    const initLine = JSON.stringify({ type: "system", subtype: "init", session_id: "x" });
    const resultLine = JSON.stringify({
      type: "result",
      result: "Done!",
      total_cost_usd: 0.1234,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 3000,
      },
      duration_ms: 30000,
      duration_api_ms: 25000,
      is_error: false,
      session_id: "abc-123",
      num_turns: 5,
    });
    const stdout = `${initLine}\n${resultLine}\n`;
    const result = parseClaudeJson(stdout);
    expect(result).not.toBeNull();
    expect(result!.total_cost_usd).toBe(0.1234);
    expect(result!.usage.input_tokens).toBe(1000);
    expect(result!.usage.output_tokens).toBe(500);
    expect(result!.result).toBe("Done!");
  });

  test("parses single-line result", () => {
    const json = JSON.stringify({
      type: "result",
      result: "hi",
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      duration_ms: 100,
      duration_api_ms: 90,
      is_error: false,
      session_id: "abc",
      num_turns: 1,
    });
    const result = parseClaudeJson(json);
    expect(result).not.toBeNull();
    expect(result!.result).toBe("hi");
  });

  test("parses result from JSON array", () => {
    const arr = JSON.stringify([
      { type: "system", subtype: "init", session_id: "x" },
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      {
        type: "result",
        result: "hello",
        total_cost_usd: 0.002,
        usage: { input_tokens: 3, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 22000 },
        duration_ms: 1300,
        duration_api_ms: 1200,
        is_error: false,
        session_id: "abc",
        num_turns: 1,
      },
    ]);
    const result = parseClaudeJson(arr);
    expect(result).not.toBeNull();
    expect(result!.result).toBe("hello");
    expect(result!.total_cost_usd).toBe(0.002);
    expect(result!.usage.cache_read_input_tokens).toBe(22000);
  });

  test("returns null for invalid JSON", () => {
    expect(parseClaudeJson("not json")).toBeNull();
    expect(parseClaudeJson("")).toBeNull();
  });

  test("returns null when no result line exists", () => {
    const initLine = JSON.stringify({ type: "system", subtype: "init" });
    expect(parseClaudeJson(initLine)).toBeNull();
  });
});

describe("runJob parallel limit", () => {
  let ctx: AppContext;

  afterEach(async () => {
    if (ctx) {
      for (const job of ctx.jobs.values()) job.instance.stop();
      await ctx.db.close();
    }
  });

  test("skips job when parallel limit is reached", async () => {
    ctx = await createTestContext();
    ctx.maxParallelJobs = 2;

    // Register 2 already-running jobs
    const running1 = makeJob({ id: 1, name: "running-1", isRunning: true });
    const running2 = makeJob({ id: 2, name: "running-2", isRunning: true });
    scheduleJob(ctx, running1);
    scheduleJob(ctx, running2);

    // Try to run a 3rd job
    const newJob = makeJob({ id: 3, name: "new-job" });
    scheduleJob(ctx, newJob);

    await runJob(ctx, newJob);

    // Job should NOT be running
    expect(newJob.isRunning).toBe(false);

    // A skipped run should be recorded
    const runs = await ctx.db.all<{ status: string; error: string }>(
      "SELECT status, error FROM runs WHERE job_id = ?", 3
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("skipped");
    expect(runs[0].error).toContain("Parallel limit reached");
  });
});

describe("runJob daily budget", () => {
  let ctx: AppContext;

  afterEach(async () => {
    if (ctx) {
      for (const job of ctx.jobs.values()) job.instance.stop();
      await ctx.db.close();
    }
  });

  test("skips without spawning once today's spend reaches the budget", async () => {
    ctx = await createTestContext();
    const job = makeJob({ id: 5, name: "budgeted", dailyBudgetUsd: 1 });
    scheduleJob(ctx, job);

    // Prior runs today already spent $1.20, over the $1 daily budget.
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      job.id, new Date().toISOString(), 0.7
    );
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      job.id, new Date().toISOString(), 0.5
    );

    await runJob(ctx, job);

    // Job should not have run (no spawn attempted, isRunning left false).
    expect(job.isRunning).toBe(false);

    // Order by id (not started_at) — the seed rows and the skip row can
    // share the same millisecond timestamp, making started_at DESC ordering
    // nondeterministic between ties.
    const runs = await ctx.db.all<{ status: string; error: string }>(
      "SELECT status, error FROM runs WHERE job_id = ? ORDER BY id DESC", job.id
    );
    expect(runs[0]?.status).toBe("skipped");
    expect(runs[0]?.error).toBe("daily budget reached");
    // Only the 2 seed rows plus the new skipped row — nothing was spawned.
    expect(runs).toHaveLength(3);
  });

  test("does not count yesterday's spend against today's budget", async () => {
    ctx = await createTestContext();
    const job = makeJob({ id: 6, name: "budgeted-2", dailyBudgetUsd: 1, cwd: "/nonexistent-dir-xyz" });
    scheduleJob(ctx, job);

    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      job.id, yesterday.toISOString(), 5.0
    );

    await runJob(ctx, job);

    // Old spend doesn't count, so the job proceeds to spawn (and fails fast
    // because cwd doesn't exist) instead of being skipped for budget.
    const runs = await ctx.db.all<{ status: string; error: string }>(
      "SELECT status, error FROM runs WHERE job_id = ? AND error != 'daily budget reached'", job.id
    );
    expect(runs).toHaveLength(1);
  });

  test("runs normally when dailyBudgetUsd is null", async () => {
    ctx = await createTestContext();
    const job = makeJob({ id: 7, name: "unbudgeted", dailyBudgetUsd: null, cwd: "/nonexistent-dir-xyz" });
    scheduleJob(ctx, job);

    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      job.id, new Date().toISOString(), 999
    );

    await runJob(ctx, job);

    const runs = await ctx.db.all<{ error: string }>(
      "SELECT error FROM runs WHERE job_id = ?", job.id
    );
    // The seed row plus one attempted (and failed, bad cwd) run — never skipped for budget.
    expect(runs.some((r) => r.error === "daily budget reached")).toBe(false);
  });
});

describe("runJob cost fallback for failed/timeout runs with no parsed cost", () => {
  let ctx: AppContext;

  afterEach(async () => {
    if (ctx) {
      for (const job of ctx.jobs.values()) job.instance.stop();
      await ctx.db.close();
    }
  });

  test("charges job.maxBudget against a failed run when no cost was parsed", async () => {
    ctx = await createTestContext();
    // Bad cwd makes Bun.spawn throw synchronously, so the run fails before
    // any stdout is ever produced — costUsd stays null off the happy path.
    const job = makeJob({ id: 20, name: "no-cost-fail", cwd: "/nonexistent-dir-xyz", maxBudget: 2.5 });
    scheduleJob(ctx, job);

    await runJob(ctx, job);

    const run = await ctx.db.get<{ status: string; cost_usd: number }>(
      "SELECT status, cost_usd FROM runs WHERE job_id = ?", job.id
    );
    expect(run?.status).toBe("failed");
    expect(run?.cost_usd).toBe(2.5);
  });

  test("charges $0 against a failed run when maxBudget is unset", async () => {
    ctx = await createTestContext();
    const job = makeJob({ id: 21, name: "no-cost-fail-nobudget", cwd: "/nonexistent-dir-xyz", maxBudget: null });
    scheduleJob(ctx, job);

    await runJob(ctx, job);

    const run = await ctx.db.get<{ status: string; cost_usd: number }>(
      "SELECT status, cost_usd FROM runs WHERE job_id = ?", job.id
    );
    expect(run?.status).toBe("failed");
    expect(run?.cost_usd).toBe(0);
  });
});

describe("runJob process group kill on timeout", () => {
  let ctx: AppContext;
  let binDir: string;
  const origPath = process.env.PATH;

  afterEach(async () => {
    process.env.PATH = origPath;
    if (ctx) {
      for (const job of ctx.jobs.values()) job.instance.stop();
      await ctx.db.close();
    }
  });

  test("SIGTERMs the whole process group, killing grandchildren too", async () => {
    ctx = await createTestContext();
    binDir = await mkdtemp(join(tmpdir(), "cron-fake-claude-"));
    const pidFile = join(binDir, "grandchild.pid");
    // Write the grandchild's pid straight to a file rather than stdout — a
    // pipe read is timing-sensitive against the (short, deliberately-hit)
    // job timeout, whereas the file is written the instant the grandchild
    // is backgrounded, well before `wait` blocks on it.
    const script = [
      "#!/bin/bash",
      "sleep 30 &",
      `echo -n $! > "${pidFile}"`,
      "wait",
      "",
    ].join("\n");
    const scriptPath = join(binDir, "claude");
    await Bun.write(scriptPath, script);
    await chmod(scriptPath, 0o755);

    process.env.PATH = `${binDir}:${origPath}`;

    // Generous relative to how fast bash forks+writes the pidfile (a few ms)
    // so the test isn't flaky under load, while still completing quickly.
    const job = makeJob({ id: 8, name: "hangs", timeoutMs: 1000 });
    scheduleJob(ctx, job);

    await runJob(ctx, job);

    const runRow = await ctx.db.get<{ error: string; log_file: string; status: string }>(
      "SELECT error, log_file, status FROM runs WHERE job_id = ?", job.id
    );
    expect(runRow?.status).toBe("failed");
    expect(runRow?.error).toContain("Timed out");

    const grandchildPid = (await Bun.file(pidFile).text()).trim();
    expect(grandchildPid).toMatch(/^\d+$/);

    // The grandchild (spawned by the fake `claude` script, inherited into
    // the same process group) must have been killed along with it — not
    // left running as an orphan.
    const psResult = Bun.spawnSync(["ps", "-p", grandchildPid!]);
    const psOutput = new TextDecoder().decode(psResult.stdout);
    expect(psOutput).not.toContain(grandchildPid);
  }, 5000);
});
