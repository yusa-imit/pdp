import { html, json } from "../lib/response";
import { getAllJobs, getJob, jobToJSON } from "../services/scheduler";
import { renderPage, renderJobsTable, renderRunsPanel, renderLogPanel } from "../views/dashboard";
import type { AppContext } from "../types";

export async function handleDashboard(ctx: AppContext): Promise<Response> {
  const all = getAllJobs(ctx);
  const jobsJSON = await Promise.all(all.map((j) => jobToJSON(ctx, j)));

  const health = {
    running: all.filter((j) => j.isRunning).length,
    jobs: all.length,
    maxParallelJobs: ctx.maxParallelJobs,
  };

  const jobsHtml = renderJobsTable(jobsJSON);
  return html(renderPage(health, jobsHtml));
}

export async function handleJobsFragment(ctx: AppContext): Promise<Response> {
  const all = getAllJobs(ctx);
  const jobsJSON = await Promise.all(all.map((j) => jobToJSON(ctx, j)));
  return html(renderJobsTable(jobsJSON));
}

export async function handleRunsFragment(ctx: AppContext, jobId: number): Promise<Response> {
  const job = getJob(ctx, jobId);
  if (!job) return json({ error: "Job not found" }, 404);

  const rows = await ctx.db.all(
    "SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 30",
    jobId
  );

  const runs = rows.map((r: any) => ({
    id: r.id,
    jobId: r.job_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    exitCode: r.exit_code,
    durationMs: r.duration_ms,
    status: r.status,
    error: r.error,
    costUsd: r.cost_usd ?? null,
    inputTokens: r.input_tokens ?? null,
    outputTokens: r.output_tokens ?? null,
  }));

  return html(renderRunsPanel(runs, job.name, jobId));
}

export async function handleLogFragment(ctx: AppContext, jobId: number, req: Request): Promise<Response> {
  const job = getJob(ctx, jobId);
  if (!job) return json({ error: "Job not found" }, 404);

  const url = new URL(req.url);
  const runId = Number(url.searchParams.get("run"));

  let logPath: string | undefined;
  if (runId) {
    const row = await ctx.db.get<{ log_file: string }>(
      "SELECT log_file FROM runs WHERE id = ? AND job_id = ?", runId, jobId
    );
    logPath = row?.log_file;
  } else {
    const row = await ctx.db.get<{ log_file: string }>(
      "SELECT log_file FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1", jobId
    );
    logPath = row?.log_file;
  }

  if (!logPath) return html(`<div class="empty">No log available.</div>`);

  try {
    const content = await Bun.file(logPath).text();
    return html(renderLogPanel(content, runId || 0));
  } catch {
    return html(`<div class="empty">Log file not found.</div>`);
  }
}
