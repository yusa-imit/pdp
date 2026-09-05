import { handleHealth } from "./routes/health";
import {
  handleListJobs,
  handleGetJob,
  handleCreateJob,
  handleUpdateJob,
  handleDeleteJob,
  handlePauseJob,
  handleResumeJob,
  handleTriggerJob,
} from "./routes/jobs";
import { handleGetRuns, handleGetLog } from "./routes/runs";
import { handleDashboard, handleJobsFragment, handleRunsFragment, handleLogFragment } from "./routes/ui";
import { json } from "./lib/response";
import type { AppContext } from "./types";

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

// Reject browser-originated state-changing requests (CSRF hardening).
// Browsers attach `Origin` and/or `Sec-Fetch-Site` to non-GET fetch/XHR/form
// requests automatically and a page can never suppress them; curl, the MCP
// stdio client, and jobs.py never send either header.
function isBrowserRequest(req: Request): boolean {
  return req.headers.has("origin") || req.headers.has("sec-fetch-site");
}

// The only two routes that read a JSON body from the request.
const JSON_BODY_ROUTES = new Set(["POST /jobs"]);
function isJsonBodyRoute(method: string, pathname: string): boolean {
  return JSON_BODY_ROUTES.has(`${method} ${pathname}`) || (method === "PATCH" && /^\/jobs\/\d+$/.test(pathname));
}

function isJsonContentType(req: Request): boolean {
  const contentType = req.headers.get("content-type") ?? "";
  return contentType.split(";")[0]!.trim().toLowerCase() === "application/json";
}

// Extracted from startServer so tests can exercise the full routing +
// security-middleware behavior without binding a real port.
export function createRequestHandler(ctx: AppContext) {
  return async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    if (method !== "GET" && isBrowserRequest(req)) {
      return json({ error: "browser origins are not allowed" }, 403);
    }

    if (isJsonBodyRoute(method, pathname) && !isJsonContentType(req)) {
      return json({ error: "Content-Type must be application/json" }, 400);
    }

    if (method === "GET" && pathname === "/") {
      return await handleDashboard(ctx);
    }

    if (method === "GET" && pathname === "/ui/jobs") {
      return await handleJobsFragment(ctx);
    }

    const uiRunsMatch = pathname.match(/^\/ui\/jobs\/(\d+)\/runs$/);
    if (method === "GET" && uiRunsMatch) {
      return await handleRunsFragment(ctx, Number(uiRunsMatch[1]));
    }

    const uiLogMatch = pathname.match(/^\/ui\/jobs\/(\d+)\/log$/);
    if (method === "GET" && uiLogMatch) {
      return await handleLogFragment(ctx, Number(uiLogMatch[1]), req);
    }

    if (method === "GET" && pathname === "/health") {
      return await handleHealth(ctx);
    }

    if (method === "GET" && pathname === "/jobs") {
      return handleListJobs(ctx);
    }

    if (method === "POST" && pathname === "/jobs") {
      return handleCreateJob(ctx, req);
    }

    const jobMatch = pathname.match(/^\/jobs\/(\d+)$/);
    if (method === "GET" && jobMatch) {
      return handleGetJob(ctx, Number(jobMatch[1]));
    }
    if (method === "PATCH" && jobMatch) {
      return handleUpdateJob(ctx, Number(jobMatch[1]), req);
    }
    if (method === "DELETE" && jobMatch) {
      return handleDeleteJob(ctx, Number(jobMatch[1]));
    }

    const pauseMatch = pathname.match(/^\/jobs\/(\d+)\/pause$/);
    if (method === "POST" && pauseMatch) {
      return await handlePauseJob(ctx, Number(pauseMatch[1]));
    }

    const resumeMatch = pathname.match(/^\/jobs\/(\d+)\/resume$/);
    if (method === "POST" && resumeMatch) {
      return await handleResumeJob(ctx, Number(resumeMatch[1]));
    }

    const triggerMatch = pathname.match(/^\/jobs\/(\d+)\/trigger$/);
    if (method === "POST" && triggerMatch) {
      return handleTriggerJob(ctx, Number(triggerMatch[1]));
    }

    const runsMatch = pathname.match(/^\/jobs\/(\d+)\/runs$/);
    if (method === "GET" && runsMatch) {
      return handleGetRuns(ctx, Number(runsMatch[1]), req);
    }

    const logMatch = pathname.match(/^\/jobs\/(\d+)\/logs$/);
    if (method === "GET" && logMatch) {
      return handleGetLog(ctx, Number(logMatch[1]), req);
    }

    return json({ error: "Not found" }, 404);
  };
}

export function startServer(ctx: AppContext) {
  const server = Bun.serve({
    port: PORT,
    hostname: HOST,
    fetch: createRequestHandler(ctx),
  });

  return server;
}
