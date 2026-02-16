import { json, text } from "../lib/response";
import { getJob } from "../services/scheduler";
import type { AppContext } from "../types";

export async function handleGetRuns(ctx: AppContext, id: number, req: Request): Promise<Response> {
  const job = getJob(ctx, id);
  if (!job) return json({ error: "Job not found" }, 404);

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || 20;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const status = url.searchParams.get("status");

  let query = "SELECT * FROM runs WHERE job_id = ?";
  const params: unknown[] = [id];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }

  query += " ORDER BY started_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = await ctx.db.all(query, ...params);
  const total = await ctx.db.get<{ cnt: number }>(
    "SELECT count(*)::INTEGER as cnt FROM runs WHERE job_id = ?", id
  );

  return json({
    runs: rows.map((r: any) => ({
      id: r.id,
      jobId: r.job_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      exitCode: r.exit_code,
      durationMs: r.duration_ms,
      logFile: r.log_file,
      error: r.error,
      status: r.status,
    })),
    total: total?.cnt ?? 0,
    limit,
    offset,
  });
}

export async function handleGetLog(ctx: AppContext, id: number, req: Request): Promise<Response> {
  const job = getJob(ctx, id);
  if (!job) return json({ error: "Job not found" }, 404);

  const url = new URL(req.url);
  const runId = url.searchParams.get("run");

  let logPath: string | undefined;

  if (runId) {
    const row = await ctx.db.get<{ log_file: string }>(
      "SELECT log_file FROM runs WHERE id = ? AND job_id = ?", Number(runId), id
    );
    logPath = row?.log_file;
  } else {
    const row = await ctx.db.get<{ log_file: string }>(
      "SELECT log_file FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1", id
    );
    logPath = row?.log_file;
  }

  if (!logPath) return json({ error: "No runs yet" }, 404);

  try {
    const content = await Bun.file(logPath).text();
    return text(content);
  } catch {
    return json({ error: "Log file not found" }, 404);
  }
}
