import { McpServer } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server";
import { z } from "zod";

const BASE_URL = process.env.CRON_SERVER_URL || "http://localhost:3000";

// --- HTTP client ---

async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (res.headers.get("content-type")?.includes("text/plain")) {
    return (await res.text()) as unknown as T;
  }
  return res.json() as Promise<T>;
}

// --- Server ---

const server = new McpServer({
  name: "cron-server",
  version: "1.0.0",
});

// --- Tools ---

server.registerTool("list_jobs", {
  title: "List Jobs",
  description: "등록된 모든 cron 잡 목록을 조회한다.",
}, async () => {
  const data = await api("/jobs");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("get_job", {
  title: "Get Job",
  description: "특정 잡의 상세 정보를 조회한다.",
  inputSchema: {
    id: z.number().describe("잡 ID"),
  },
}, async ({ id }) => {
  const data = await api(`/jobs/${id}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("create_job", {
  title: "Create Job",
  description: "새로운 cron 잡을 등록한다. Claude Code 개발 프로세스를 스케줄링할 때 사용한다.",
  inputSchema: {
    name: z.string().describe("잡 이름 (식별용)"),
    expression: z.string().describe("cron 표현식 (예: '0 */3 * * *' = 3시간마다)"),
    prompt: z.string().describe("Claude Code에 전달할 프롬프트"),
    cwd: z.string().describe("Claude Code 실행 디렉토리 (절대경로)"),
    model: z.string().optional().describe("모델 (기본: sonnet)"),
    permissionMode: z.string().optional().describe("권한 모드 (기본: bypassPermissions)"),
    maxBudget: z.number().optional().describe("최대 API 비용 USD"),
    timeoutMs: z.number().optional().describe("타임아웃 ms (기본: 600000)"),
    allowedTools: z.array(z.string()).optional().describe("허용 도구 목록"),
    appendSystemPrompt: z.string().optional().describe("추가 시스템 프롬프트"),
  },
}, async (args) => {
  const data = await api("/jobs", { method: "POST", body: JSON.stringify(args) });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("delete_job", {
  title: "Delete Job",
  description: "잡을 삭제한다. 스케줄이 중지되고 실행 이력도 삭제된다.",
  inputSchema: {
    id: z.number().describe("잡 ID"),
  },
}, async ({ id }) => {
  const data = await api(`/jobs/${id}`, { method: "DELETE" });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("trigger_job", {
  title: "Trigger Job",
  description: "잡을 즉시 수동 실행한다. 백그라운드에서 실행되며 응답은 즉시 반환된다.",
  inputSchema: {
    id: z.number().describe("잡 ID"),
  },
}, async ({ id }) => {
  const data = await api(`/jobs/${id}/trigger`, { method: "POST" });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("pause_job", {
  title: "Pause Job",
  description: "잡의 스케줄을 일시정지한다.",
  inputSchema: {
    id: z.number().describe("잡 ID"),
  },
}, async ({ id }) => {
  const data = await api(`/jobs/${id}/pause`, { method: "POST" });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("resume_job", {
  title: "Resume Job",
  description: "일시정지된 잡의 스케줄을 재개한다.",
  inputSchema: {
    id: z.number().describe("잡 ID"),
  },
}, async ({ id }) => {
  const data = await api(`/jobs/${id}/resume`, { method: "POST" });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("get_runs", {
  title: "Get Runs",
  description: "잡의 실행 이력을 조회한다.",
  inputSchema: {
    id: z.number().describe("잡 ID"),
    limit: z.number().optional().describe("반환 건수 (기본: 20)"),
    offset: z.number().optional().describe("건너뛸 건수 (기본: 0)"),
    status: z.string().optional().describe("상태 필터: success, failed, running"),
  },
}, async ({ id, limit, offset, status }) => {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (offset) params.set("offset", String(offset));
  if (status) params.set("status", status);
  const qs = params.toString();
  const data = await api(`/jobs/${id}/runs${qs ? `?${qs}` : ""}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("get_log", {
  title: "Get Log",
  description: "실행 로그를 텍스트로 반환한다. run을 생략하면 마지막 실행의 로그를 반환한다.",
  inputSchema: {
    id: z.number().describe("잡 ID"),
    run: z.number().optional().describe("특정 실행 ID"),
  },
}, async ({ id, run }) => {
  const qs = run ? `?run=${run}` : "";
  const data = await api<string>(`/jobs/${id}/logs${qs}`);
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
});

server.registerTool("health", {
  title: "Health Check",
  description: "cron 서버 상태를 확인한다.",
}, async () => {
  const data = await api("/health");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Cron MCP server running on stdio");
