import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { handleHealth } from "../src/routes/health";
import {
  handleListJobs,
  handleGetJob,
  handleCreateJob,
  handleUpdateJob,
  handleDeleteJob,
  handlePauseJob,
  handleResumeJob,
  handleTriggerJob,
} from "../src/routes/jobs";
import { handleGetRuns } from "../src/routes/runs";
import { createRequestHandler } from "../src/server";
import type { AppContext } from "../src/types";
import { createTestContext } from "./helpers";
import { createJobInDB } from "../src/services/scheduler";

let ctx: AppContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  for (const job of ctx.jobs.values()) {
    job.instance.stop();
  }
  await ctx.db.close();
});

async function jsonBody(res: Response) {
  return res.json();
}

const defaultOpts = {
  model: "sonnet",
  permissionMode: "bypassPermissions",
  maxBudget: null,
  timeoutMs: 60000,
  allowedTools: [] as string[],
  appendSystemPrompt: "",
  sessionLimitThreshold: 90,
  dailyBudgetUsd: null as number | null,
  blockTokenLimit: null as number | null,
};

describe("GET /health", () => {
  test("returns ok with zero jobs", async () => {
    const res = await handleHealth(ctx);
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.status).toBe("ok");
    expect(body.jobs).toBe(0);
    expect(body.running).toBe(0);
  });

  test("counts jobs correctly", async () => {
    await createJobInDB(
      ctx,
      { name: "j1", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const res = await handleHealth(ctx);
    const body = await jsonBody(res);
    expect(body.jobs).toBe(1);
    expect(body.running).toBe(0);
  });
});

describe("POST /jobs", () => {
  test("creates a job with valid body", async () => {
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "new-job",
        expression: "*/10 * * * *",
        prompt: "do things",
        cwd: "/tmp",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleCreateJob(ctx, req);
    expect(res.status).toBe(201);

    const body = await jsonBody(res);
    expect(body.name).toBe("new-job");
    expect(body.expression).toBe("*/10 * * * *");
    expect(body.id).toBeGreaterThan(0);
    expect(body.sessionLimitThreshold).toBe(90);
    expect(body.dailyBudgetUsd).toBeNull();
  });

  test("creates a job with session limit fields", async () => {
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "budget-job",
        expression: "*/10 * * * *",
        prompt: "do things",
        cwd: "/tmp",
        sessionLimitThreshold: 80,
        dailyBudgetUsd: 50,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleCreateJob(ctx, req);
    expect(res.status).toBe(201);

    const body = await jsonBody(res);
    expect(body.sessionLimitThreshold).toBe(80);
    expect(body.dailyBudgetUsd).toBe(50);
  });

  test("returns 400 for invalid sessionLimitThreshold", async () => {
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "bad-threshold",
        expression: "*/10 * * * *",
        prompt: "p",
        cwd: "/tmp",
        sessionLimitThreshold: 150,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleCreateJob(ctx, req);
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toContain("sessionLimitThreshold");
  });

  test("returns 400 for negative dailyBudgetUsd", async () => {
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "bad-budget",
        expression: "*/10 * * * *",
        prompt: "p",
        cwd: "/tmp",
        dailyBudgetUsd: -10,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleCreateJob(ctx, req);
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toContain("dailyBudgetUsd");
  });

  test("returns 400 for non-array extraArgs", async () => {
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "bad-extra-args",
        expression: "*/10 * * * *",
        prompt: "p",
        cwd: "/tmp",
        extraArgs: "--debug",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleCreateJob(ctx, req);
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toContain("extraArgs");
  });

  test("returns 400 when extraArgs overrides a job-owned flag", async () => {
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "override-flag",
        expression: "*/10 * * * *",
        prompt: "p",
        cwd: "/tmp",
        extraArgs: ["--model", "opus"],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleCreateJob(ctx, req);
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("extraArgs must not override job-owned flags");
  });

  test("creates a job with valid extraArgs", async () => {
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "extra-args-job",
        expression: "*/10 * * * *",
        prompt: "p",
        cwd: "/tmp",
        extraArgs: ["--debug", "--add-dir", "/tmp/x"],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleCreateJob(ctx, req);
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.extraArgs).toEqual(["--debug", "--add-dir", "/tmp/x"]);
  });

  test("returns 400 for missing fields", async () => {
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({ name: "incomplete" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleCreateJob(ctx, req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid cron expression", async () => {
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "bad-cron",
        expression: "not a cron",
        prompt: "p",
        cwd: "/tmp",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleCreateJob(ctx, req);
    expect(res.status).toBe(400);

    const body = await jsonBody(res);
    expect(body.error).toContain("Invalid cron expression");
  });
});

describe("PATCH /jobs/:id", () => {
  test("returns 400 for non-array extraArgs", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "patch-target", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const req = new Request(`http://localhost/jobs/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({ extraArgs: "not-an-array" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleUpdateJob(ctx, job.id, req);
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toContain("extraArgs");
  });

  test("returns 400 when extraArgs overrides a job-owned flag", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "patch-target-2", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const req = new Request(`http://localhost/jobs/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({ extraArgs: ["--append-system-prompt", "x"] }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleUpdateJob(ctx, job.id, req);
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("extraArgs must not override job-owned flags");
  });

  test("updates extraArgs with a valid array", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "patch-target-3", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const req = new Request(`http://localhost/jobs/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({ extraArgs: ["--debug"] }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleUpdateJob(ctx, job.id, req);
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.extraArgs).toEqual(["--debug"]);
  });
});

describe("GET /jobs", () => {
  test("returns empty list", async () => {
    const res = await handleListJobs(ctx);
    const body = await jsonBody(res);
    expect(body.jobs).toEqual([]);
  });

  test("returns created jobs", async () => {
    await createJobInDB(
      ctx,
      { name: "j1", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const res = await handleListJobs(ctx);
    const body = await jsonBody(res);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].name).toBe("j1");
  });
});

describe("GET /jobs/:id", () => {
  test("returns 404 for missing job", async () => {
    const res = await handleGetJob(ctx, 999);
    expect(res.status).toBe(404);
  });

  test("returns job details", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "detail", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const res = await handleGetJob(ctx, job.id);
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.name).toBe("detail");
    expect(body.id).toBe(job.id);
  });
});

describe("DELETE /jobs/:id", () => {
  test("returns 404 for missing job", async () => {
    const res = await handleDeleteJob(ctx, 999);
    expect(res.status).toBe(404);
  });

  test("deletes existing job", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "to-delete", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const res = await handleDeleteJob(ctx, job.id);
    expect(res.status).toBe(200);
    expect(ctx.jobs.has(job.id)).toBe(false);
  });
});

describe("POST /jobs/:id/pause & resume", () => {
  test("pauses and resumes a job", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "toggle", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const pauseRes = await handlePauseJob(ctx, job.id);
    expect(pauseRes.status).toBe(200);

    const resumeRes = await handleResumeJob(ctx, job.id);
    expect(resumeRes.status).toBe(200);
  });

  test("returns 404 for missing job", async () => {
    expect((await handlePauseJob(ctx, 999)).status).toBe(404);
    expect((await handleResumeJob(ctx, 999)).status).toBe(404);
  });
});

describe("POST /jobs/:id/trigger", () => {
  test("returns 404 for missing job", () => {
    const res = handleTriggerJob(ctx, 999);
    expect(res.status).toBe(404);
  });

  test("returns 409 if job is already running", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "busy", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );
    job.isRunning = true;

    const res = handleTriggerJob(ctx, job.id);
    expect(res.status).toBe(409);
  });
});

describe("GET /jobs/:id/runs", () => {
  test("returns 404 for missing job", async () => {
    const req = new Request("http://localhost/jobs/999/runs");
    const res = await handleGetRuns(ctx, 999, req);
    expect(res.status).toBe(404);
  });

  test("returns empty runs list", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "no-runs", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const req = new Request(`http://localhost/jobs/${job.id}/runs`);
    const res = await handleGetRuns(ctx, job.id, req);
    const body = await jsonBody(res);

    expect(body.runs).toEqual([]);
    expect(body.total).toBe(0);
  });

  test("returns runs with pagination and cost data", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "with-runs", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    for (let i = 0; i < 3; i++) {
      await ctx.db.run(
        "INSERT INTO runs (job_id, started_at, status, cost_usd, input_tokens, output_tokens) VALUES (?, ?, 'success', ?, ?, ?)",
        job.id, new Date(Date.now() - i * 60000).toISOString(), 0.1 * (i + 1), 1000 * (i + 1), 500 * (i + 1)
      );
    }

    const req = new Request(`http://localhost/jobs/${job.id}/runs?limit=2`);
    const res = await handleGetRuns(ctx, job.id, req);
    const body = await jsonBody(res);

    expect(body.runs).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
    expect(body.runs[0].costUsd).toBeDefined();
    expect(body.runs[0].inputTokens).toBeDefined();
    expect(body.runs[0].outputTokens).toBeDefined();
  });
});

describe("cross-site CSRF rejection", () => {
  test("rejects a cross-site request signaled by Sec-Fetch-Site", async () => {
    const handler = createRequestHandler(ctx);
    const req = new Request("http://localhost/jobs/1/trigger", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.error).toBe("cross-site requests are not allowed");
  });

  test("rejects a non-GET request whose Origin doesn't match the Host", async () => {
    const handler = createRequestHandler(ctx);
    const req = new Request("http://localhost/jobs/1/pause", {
      method: "POST",
      headers: { Origin: "http://evil.example", Host: "localhost" },
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
  });

  test("allows a same-origin request signaled by Sec-Fetch-Site (htmx dashboard buttons)", async () => {
    const handler = createRequestHandler(ctx);
    const job = await createJobInDB(
      ctx,
      { name: "csrf-same-origin", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const req = new Request(`http://localhost/jobs/${job.id}/pause`, {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin", Origin: "http://localhost", Host: "localhost" },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("allows a request whose Origin matches the Host", async () => {
    const handler = createRequestHandler(ctx);
    const job = await createJobInDB(
      ctx,
      { name: "csrf-origin-match", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const req = new Request(`http://localhost/jobs/${job.id}/resume`, {
      method: "POST",
      headers: { Origin: "http://localhost", Host: "localhost" },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("allows a non-GET request with neither header (curl/MCP-style)", async () => {
    const handler = createRequestHandler(ctx);
    const job = await createJobInDB(
      ctx,
      { name: "csrf-ok", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const req = new Request(`http://localhost/jobs/${job.id}/pause`, { method: "POST" });
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("allows a GET request even with a cross-site Origin header", async () => {
    const handler = createRequestHandler(ctx);
    const req = new Request("http://localhost/health", {
      headers: { Origin: "http://evil.example" },
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
  });
});

describe("optional bearer token (CRON_TOKEN)", () => {
  const originalToken = process.env.CRON_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.CRON_TOKEN;
    else process.env.CRON_TOKEN = originalToken;
  });

  test("rejects a non-GET request missing the bearer token when CRON_TOKEN is set", async () => {
    process.env.CRON_TOKEN = "secret-token";
    const handler = createRequestHandler(ctx);
    const job = await createJobInDB(
      ctx,
      { name: "needs-token", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const res = await handler(new Request(`http://localhost/jobs/${job.id}/pause`, { method: "POST" }));
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect(body.error).toBe("unauthorized");
  });

  test("allows a non-GET request carrying the correct bearer token", async () => {
    process.env.CRON_TOKEN = "secret-token";
    const handler = createRequestHandler(ctx);
    const job = await createJobInDB(
      ctx,
      { name: "has-token", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const res = await handler(new Request(`http://localhost/jobs/${job.id}/pause`, {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" },
    }));
    expect(res.status).toBe(200);
  });

  test("GET stays open even when CRON_TOKEN is set and no header is sent", async () => {
    process.env.CRON_TOKEN = "secret-token";
    const handler = createRequestHandler(ctx);
    const res = await handler(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
  });

  test("does not require the token when CRON_TOKEN is unset", async () => {
    delete process.env.CRON_TOKEN;
    const handler = createRequestHandler(ctx);
    const job = await createJobInDB(
      ctx,
      { name: "no-token-needed", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const res = await handler(new Request(`http://localhost/jobs/${job.id}/pause`, { method: "POST" }));
    expect(res.status).toBe(200);
  });
});

describe("Content-Type enforcement on POST/PATCH bodies", () => {
  test("rejects POST /jobs without Content-Type: application/json", async () => {
    const handler = createRequestHandler(ctx);
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({ name: "no-ct", expression: "0 * * * *", prompt: "p", cwd: "/tmp" }),
    });

    const res = await handler(req);
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toContain("Content-Type");
  });

  test("rejects PATCH /jobs/:id with a non-JSON Content-Type", async () => {
    const handler = createRequestHandler(ctx);
    const job = await createJobInDB(
      ctx,
      { name: "patch-no-ct", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const req = new Request(`http://localhost/jobs/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "renamed" }),
      headers: { "Content-Type": "text/plain" },
    });

    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("accepts POST /jobs with a Content-Type that includes a charset param", async () => {
    const handler = createRequestHandler(ctx);
    const req = new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({ name: "charset-ok", expression: "0 * * * *", prompt: "p", cwd: "/tmp" }),
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });

    const res = await handler(req);
    expect(res.status).toBe(201);
  });

  test("does not require Content-Type on bodyless POST actions (pause/resume)", async () => {
    // Deliberately exercises /pause rather than /trigger — trigger would
    // fire a real (unawaited) `claude` process spawn from this test.
    const handler = createRequestHandler(ctx);
    const job = await createJobInDB(
      ctx,
      { name: "no-body-action", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const res = await handler(new Request(`http://localhost/jobs/${job.id}/pause`, { method: "POST" }));
    expect(res.status).toBe(200);
  });

  test("does not require Content-Type on DELETE /jobs/:id", async () => {
    const handler = createRequestHandler(ctx);
    const job = await createJobInDB(
      ctx,
      { name: "delete-no-ct", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const res = await handler(new Request(`http://localhost/jobs/${job.id}`, { method: "DELETE" }));
    expect(res.status).toBe(200);
  });
});
