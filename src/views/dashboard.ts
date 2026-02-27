import type { CronJob, AppContext, RunRow } from "../types";

interface HealthData {
  running: number;
  jobs: number;
  maxParallelJobs: number;
}

interface JobJSON {
  id: number;
  name: string;
  expression: string;
  model: string;
  scheduled: boolean;
  isRunning: boolean;
  nextRun: string | null;
  lastRun: { startedAt: string; status: string; durationMs: number | null; costUsd: number | null } | null;
  runCount: number;
  cwd: string;
}

interface RunJSON {
  id: number;
  jobId: number;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
  status: string;
  error: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 0) {
    const abs = Math.abs(diff);
    const min = Math.round(abs / 60000);
    if (min < 60) return `in ${min}m`;
    const hr = Math.floor(min / 60);
    return `in ${hr}h ${min % 60}m`;
  }
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function statusBadge(job: JobJSON): string {
  if (job.isRunning) return `<span class="badge running">running</span>`;
  if (!job.scheduled) return `<span class="badge paused">paused</span>`;
  return `<span class="badge active">active</span>`;
}

function runStatusBadge(status: string): string {
  if (status === "running") return `<span class="badge running">running</span>`;
  if (status === "success") return `<span class="badge active">success</span>`;
  if (status === "skipped") return `<span class="badge paused">skipped</span>`;
  return `<span class="badge failed">failed</span>`;
}

export function renderJobsTable(jobs: JobJSON[]): string {
  if (jobs.length === 0) {
    return `<div class="empty">No jobs registered.</div>`;
  }

  const rows = jobs.map((j) => `
    <tr class="job-row" hx-get="/ui/jobs/${j.id}/runs" hx-target="#detail-panel" hx-swap="innerHTML">
      <td><strong>${escapeHtml(j.name)}</strong></td>
      <td><code>${escapeHtml(j.expression)}</code></td>
      <td>${escapeHtml(j.model)}</td>
      <td>${statusBadge(j)}</td>
      <td>${formatRelative(j.nextRun)}</td>
      <td>${j.lastRun ? formatRelative(j.lastRun.startedAt) : "-"}</td>
      <td>${j.runCount}</td>
      <td>${j.lastRun?.costUsd != null ? `$${j.lastRun.costUsd.toFixed(2)}` : "-"}</td>
      <td class="actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm"
          hx-post="/jobs/${j.id}/trigger"
          hx-swap="none"
          hx-on::after-request="htmx.trigger('#jobs-table','refresh')"
          ${j.isRunning ? "disabled" : ""}>
          ▶
        </button>
        ${j.scheduled
          ? `<button class="btn btn-sm"
              hx-post="/jobs/${j.id}/pause"
              hx-swap="none"
              hx-on::after-request="htmx.trigger('#jobs-table','refresh')">
              ⏸
            </button>`
          : `<button class="btn btn-sm"
              hx-post="/jobs/${j.id}/resume"
              hx-swap="none"
              hx-on::after-request="htmx.trigger('#jobs-table','refresh')">
              ▶️
            </button>`
        }
      </td>
    </tr>
  `).join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Schedule</th>
          <th>Model</th>
          <th>Status</th>
          <th>Next Run</th>
          <th>Last Run</th>
          <th>Runs</th>
          <th>Last Cost</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function renderRunsPanel(runs: RunJSON[], jobName: string, jobId: number): string {
  if (runs.length === 0) {
    return `<h3>Runs — ${escapeHtml(jobName)}</h3><div class="empty">No runs yet.</div>`;
  }

  const rows = runs.map((r) => `
    <tr class="run-row" hx-get="/ui/jobs/${jobId}/log?run=${r.id}" hx-target="#log-panel" hx-swap="innerHTML">
      <td>#${r.id}</td>
      <td>${runStatusBadge(r.status)}</td>
      <td>${formatRelative(r.startedAt)}</td>
      <td>${formatDuration(r.durationMs)}</td>
      <td>${r.costUsd != null ? `$${r.costUsd.toFixed(2)}` : "-"}</td>
      <td>${r.inputTokens != null ? r.inputTokens.toLocaleString() : "-"}</td>
      <td>${r.outputTokens != null ? r.outputTokens.toLocaleString() : "-"}</td>
      <td class="error-col">${r.error ? escapeHtml(r.error.substring(0, 80)) : "-"}</td>
    </tr>
  `).join("");

  return `
    <h3>Runs — ${escapeHtml(jobName)}</h3>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Status</th>
          <th>Started</th>
          <th>Duration</th>
          <th>Cost</th>
          <th>In Tokens</th>
          <th>Out Tokens</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function renderLogPanel(log: string, runId: number): string {
  return `
    <h3>Log — Run #${runId}</h3>
    <pre class="log-viewer">${escapeHtml(log)}</pre>
  `;
}

export function renderPage(health: HealthData, jobsHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cron Dashboard</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 { color: #f0f6fc; margin-bottom: 4px; font-size: 1.5rem; }
    h3 { color: #f0f6fc; margin-bottom: 12px; font-size: 1.1rem; }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #21262d;
    }
    .stats {
      display: flex;
      gap: 16px;
      font-size: 0.85rem;
    }
    .stat {
      background: #161b22;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid #21262d;
    }
    .stat-value { color: #58a6ff; font-weight: 600; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #161b22;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #21262d;
    }
    th {
      text-align: left;
      padding: 10px 12px;
      background: #1c2128;
      color: #8b949e;
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    td {
      padding: 10px 12px;
      border-top: 1px solid #21262d;
      font-size: 0.9rem;
    }
    .job-row { cursor: pointer; }
    .job-row:hover, .run-row:hover { background: #1c2128; }
    .run-row { cursor: pointer; }
    code {
      background: #1c2128;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85rem;
      color: #79c0ff;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge.active { background: #0d4429; color: #3fb950; }
    .badge.paused { background: #341a00; color: #d29922; }
    .badge.running { background: #0c2d6b; color: #58a6ff; }
    .badge.failed { background: #3d1214; color: #f85149; }
    .actions { white-space: nowrap; }
    .btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .btn:hover { background: #30363d; border-color: #8b949e; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-sm { padding: 2px 8px; }
    #detail-panel, #log-panel {
      margin-top: 20px;
    }
    .log-viewer {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 8px;
      padding: 16px;
      font-size: 0.8rem;
      line-height: 1.5;
      overflow-x: auto;
      max-height: 500px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .empty {
      text-align: center;
      padding: 40px;
      color: #8b949e;
      background: #161b22;
      border-radius: 8px;
      border: 1px solid #21262d;
    }
    .error-col {
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #f85149;
      font-size: 0.8rem;
    }
    .htmx-indicator { display: none; }
    .htmx-request .htmx-indicator { display: inline; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Cron Dashboard</h1>
    <div class="stats">
      <div class="stat">Running: <span class="stat-value">${health.running}/${health.jobs}</span></div>
      <div class="stat">Parallel: <span class="stat-value">${health.maxParallelJobs}</span></div>
    </div>
  </div>

  <div id="jobs-table"
    hx-get="/ui/jobs"
    hx-trigger="every 10s, refresh"
    hx-swap="innerHTML">
    ${jobsHtml}
  </div>

  <div id="detail-panel"></div>
  <div id="log-panel"></div>
</body>
</html>`;
}
