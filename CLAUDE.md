# Cron Server — Claude Code Scheduler

## Project Overview

A Bun-based cron scheduling server that autonomously triggers Claude Code development cycles on configurable schedules. Built with TypeScript, DuckDB for persistence, and croner for cron scheduling. Exposes both an HTTP REST API and an MCP (Model Context Protocol) interface.

- **Runtime**: Bun 1.3.9+
- **Language**: TypeScript
- **Database**: DuckDB (embedded, file-based at `data/cron.db`)
- **Scheduler**: croner v10
- **MCP SDK**: @modelcontextprotocol/sdk v1.26
- **Port**: 3000 (configurable via `PORT` env)

## Project Structure

```
src/
├── index.ts              # Bootstrap: create DB, AppContext, start server
├── server.ts             # Bun.serve() HTTP router
├── db.ts                 # DuckDB factory (createDb → Db interface)
├── types.ts              # Shared types: CronJob, AppContext, JobRow, RunRow
├── mcp.ts                # MCP stdio server wrapping HTTP API
├── routes/
│   ├── health.ts         # GET /health
│   ├── jobs.ts           # CRUD + pause/resume/trigger for jobs
│   └── runs.ts           # Run history + log retrieval
├── services/
│   ├── scheduler.ts      # Job lifecycle, DB persistence, serialization
│   └── runner.ts         # Claude CLI arg building, process execution
└── lib/
    └── response.ts       # json() / text() response helpers
tests/
├── helpers.ts            # createTestContext() with in-memory DuckDB
├── runner.test.ts        # buildClaudeArgs tests
├── scheduler.test.ts     # Scheduler service tests
└── routes.test.ts        # HTTP route handler tests
data/
├── cron.db               # DuckDB database
└── logs/                 # Per-run log files
docs/
    └── API.md            # Full API reference
```

## Development Workflow

### Autonomous Development Protocol

1. **Context Load**: Read this file, `docs/API.md`, and `.claude/memory/` files
2. **Status Check**: `git log --oneline -20 && git status` to understand state
3. **Plan**: Identify next work item, design approach
4. **Implement**: Write code following conventions below
5. **Test**: Run `bun test` — all tests must pass
6. **Validate**: Start server with `bun start`, verify health endpoint
7. **Commit**: Descriptive message with Co-Authored-By
8. **Push**: `git push` to sync with remote
9. **Memory Update**: Record decisions, patterns, session summary in `.claude/memory/`
10. **Summary**: Send Discord notification via openclaw CLI

### Running the Project

```bash
bun start              # Start server on port 3000
bun dev                # Start with --watch for hot reload
bun test               # Run all tests
bun run mcp            # Start MCP stdio server
```

### LaunchAgent (Always-On)

The server runs as a macOS LaunchAgent (`com.fn.cron-server`):
```bash
launchctl unload ~/Library/LaunchAgents/com.fn.cron-server.plist   # Stop
launchctl load ~/Library/LaunchAgents/com.fn.cron-server.plist     # Start
```

Logs: `data/launchd-stdout.log`, `data/launchd-stderr.log`

## Architecture

### AppContext (Dependency Injection)

All services and routes receive `AppContext` as the first parameter:
```typescript
interface AppContext {
  db: Db;                       // DuckDB instance
  jobs: Map<number, CronJob>;   // In-memory job registry
  logsDir: string;              // Log output directory
}
```

This pattern enables testability — tests use in-memory DuckDB via `createTestContext()`.

### Data Flow

```
HTTP Request → server.ts (router) → routes/*.ts → services/*.ts → DuckDB
                                                                  → Bun.spawn(claude CLI)
MCP Request → mcp.ts → HTTP localhost:3000 → same flow as above
```

### Database Schema

**jobs**: id (auto-seq), name, expression, prompt, cwd, model, permission_mode, max_budget, timeout_ms, allowed_tools (JSON text), append_system_prompt, created_at

**runs**: id (auto-seq), job_id, started_at, finished_at, exit_code, duration_ms, log_file, error, status

### DuckDB Specifics

- Auto-increment uses `CREATE SEQUENCE` + `DEFAULT nextval('seq_name')`
- No `last_insert_rowid()` — use `ORDER BY id DESC LIMIT 1` after insert
- `VARCHAR[]` arrays don't work well — store as JSON text, parse with `JSON.stringify`/`JSON.parse`
- Cast timestamps for string output: `created_at::VARCHAR as created_at`
- Single-process access only — stop server before running CLI queries

## Coding Standards

### TypeScript Conventions

- **Types**: Interfaces for data shapes, type imports with `import type`
- **Functions**: Named exports, no default exports
- **Async**: Use async/await, not raw Promises
- **Errors**: Let errors propagate naturally, handle at route level
- **Naming**: camelCase for variables/functions, PascalCase for types/interfaces

### API Conventions

- All responses are JSON with `Content-Type: application/json`
- Error format: `{ "error": "message" }` with appropriate status code
- Success format: direct data object or `{ "message": "..." }`
- PATCH for partial updates, POST for creation and actions

### Testing Conventions

- Test framework: `bun:test` (describe/test/expect)
- Test helper: `createTestContext()` in `tests/helpers.ts`
- Each test gets its own in-memory DuckDB (no shared state)
- Clean up cron instances in afterEach to prevent leaks
- Test files mirror source structure: `tests/runner.test.ts` ↔ `src/services/runner.ts`

## Git Workflow

### Branch Strategy

- `main` — stable, always passing tests
- `feat/*` — new features
- `fix/*` — bug fixes
- `refactor/*` — structural changes

### Commit Convention

```
<type>: <concise description>

Co-Authored-By: Claude <agent>
```

Types: feat, fix, refactor, test, docs, chore

## Memory System

Long-term knowledge is stored in `.claude/memory/`:
- `architecture.md` — System design decisions and data flow
- `patterns.md` — Verified code patterns and conventions
- `debugging.md` — Bug solutions (Symptom/Cause/Fix format)
- `decisions.md` — Decision log with dates and rationale
- `project-context.md` — Current status and roadmap
- `session-summaries/` — Per-session records

## Core Rules

1. **Always read before writing** — understand existing code before modifying
2. **Test after every change** — `bun test` must pass before committing
3. **AppContext everywhere** — never use module-level singletons
4. **Incremental commits** — small, focused changes with clear messages
5. **DuckDB quirks** — remember single-process access, JSON text for arrays, sequences for IDs
6. **Never force push main**
7. **Server always on** — restart LaunchAgent after code changes
8. **MCP stays thin** — MCP server is just an HTTP client, logic lives in the main server
9. **Discord at end of cycle** — always send summary via `openclaw message send`
10. **Update memory** — record new patterns, decisions, and session summaries
