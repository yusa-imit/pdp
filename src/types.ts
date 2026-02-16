import type { Cron } from "croner";
import type { Db } from "./db";

export interface CronJob {
  id: number;
  name: string;
  expression: string;
  prompt: string;
  cwd: string;
  model: string;
  permissionMode: string;
  maxBudget: number | null;
  timeoutMs: number;
  allowedTools: string[];
  appendSystemPrompt: string;
  instance: Cron;
  createdAt: string;
  isRunning: boolean;
}

export interface CreateJobBody {
  name: string;
  expression: string;
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: string;
  maxBudget?: number;
  timeoutMs?: number;
  allowedTools?: string[];
  appendSystemPrompt?: string;
}

export interface JobRow {
  id: number;
  name: string;
  expression: string;
  prompt: string;
  cwd: string;
  model: string;
  permission_mode: string;
  max_budget: number | null;
  timeout_ms: number;
  allowed_tools: string;
  append_system_prompt: string;
  created_at: string;
}

export interface RunRow {
  id: number;
  job_id: number;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  log_file: string | null;
  error: string | null;
  status: string;
}

export interface AppContext {
  db: Db;
  jobs: Map<number, CronJob>;
  logsDir: string;
}
