import { describe, test, expect } from "bun:test";
import { buildClaudeArgs, parseClaudeJson } from "../src/services/runner";
import type { CronJob } from "../src/types";
import { Cron } from "croner";

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
});

describe("parseClaudeJson", () => {
  test("parses valid JSON output", () => {
    const json = JSON.stringify({
      result: "Done!",
      cost_usd: 0.1234,
      input_tokens: 1000,
      output_tokens: 500,
      duration_ms: 30000,
      duration_api_ms: 25000,
      is_error: false,
      session_id: "abc-123",
      num_turns: 5,
    });
    const result = parseClaudeJson(json);
    expect(result).not.toBeNull();
    expect(result!.cost_usd).toBe(0.1234);
    expect(result!.input_tokens).toBe(1000);
    expect(result!.output_tokens).toBe(500);
    expect(result!.result).toBe("Done!");
  });

  test("returns null for invalid JSON", () => {
    expect(parseClaudeJson("not json")).toBeNull();
    expect(parseClaudeJson("")).toBeNull();
  });
});
