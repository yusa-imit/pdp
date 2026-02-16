import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { handleHealth } from "../src/routes/health";
import {
  handleListJobs,
  handleGetJob,
  handleCreateJob,
  handleDeleteJob,
  handlePauseJob,
  handleResumeJob,
  handleTriggerJob,
} from "../src/routes/jobs";
import { handleGetRuns } from "../src/routes/runs";
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

describe("GET /health", () => {
  test("returns ok with zero jobs", () => {
    const res = handleHealth(ctx);
    expect(res.status).toBe(200);
    return jsonBody(res).then((body) => {
      expect(body.status).toBe("ok");
      expect(body.jobs).toBe(0);
      expect(body.running).toBe(0);
    });
  });

  test("counts jobs correctly", async () => {
    await createJobInDB(
      ctx,
      { name: "j1", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      { model: "sonnet", permissionMode: "bypassPermissions", maxBudget: null, timeoutMs: 60000, allowedTools: [], appendSystemPrompt: "" }
    );

    const res = handleHealth(ctx);
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
      { model: "sonnet", permissionMode: "bypassPermissions", maxBudget: null, timeoutMs: 60000, allowedTools: [], appendSystemPrompt: "" }
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
      { model: "sonnet", permissionMode: "bypassPermissions", maxBudget: null, timeoutMs: 60000, allowedTools: [], appendSystemPrompt: "" }
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
      { model: "sonnet", permissionMode: "bypassPermissions", maxBudget: null, timeoutMs: 60000, allowedTools: [], appendSystemPrompt: "" }
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
      { model: "sonnet", permissionMode: "bypassPermissions", maxBudget: null, timeoutMs: 60000, allowedTools: [], appendSystemPrompt: "" }
    );

    const pauseRes = handlePauseJob(ctx, job.id);
    expect(pauseRes.status).toBe(200);

    const resumeRes = handleResumeJob(ctx, job.id);
    expect(resumeRes.status).toBe(200);
  });

  test("returns 404 for missing job", () => {
    expect(handlePauseJob(ctx, 999).status).toBe(404);
    expect(handleResumeJob(ctx, 999).status).toBe(404);
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
      { model: "sonnet", permissionMode: "bypassPermissions", maxBudget: null, timeoutMs: 60000, allowedTools: [], appendSystemPrompt: "" }
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
      { model: "sonnet", permissionMode: "bypassPermissions", maxBudget: null, timeoutMs: 60000, allowedTools: [], appendSystemPrompt: "" }
    );

    const req = new Request(`http://localhost/jobs/${job.id}/runs`);
    const res = await handleGetRuns(ctx, job.id, req);
    const body = await jsonBody(res);

    expect(body.runs).toEqual([]);
    expect(body.total).toBe(0);
  });

  test("returns runs with pagination", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "with-runs", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      { model: "sonnet", permissionMode: "bypassPermissions", maxBudget: null, timeoutMs: 60000, allowedTools: [], appendSystemPrompt: "" }
    );

    for (let i = 0; i < 3; i++) {
      await ctx.db.run(
        "INSERT INTO runs (job_id, started_at, status) VALUES (?, ?, 'success')",
        job.id, new Date(Date.now() - i * 60000).toISOString()
      );
    }

    const req = new Request(`http://localhost/jobs/${job.id}/runs?limit=2`);
    const res = await handleGetRuns(ctx, job.id, req);
    const body = await jsonBody(res);

    expect(body.runs).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
  });
});
