# Decision Log

## 2026-02-16: Initial Build
- Built cron server with Bun + croner + DuckDB
- Chose DuckDB over JSON file for persistence (analytical query potential)
- HTTP API on port 3000 with REST conventions

## 2026-02-16: Claude Code Integration
- Runner spawns `claude -p --permission-mode bypassPermissions` for autonomous execution
- Added timeout handling with Promise.race, concurrency guard with isRunning flag
- Log streaming to per-run files via Bun.file().writer()

## 2026-02-16: MCP Server
- Added MCP stdio interface as thin HTTP client wrapper
- Registered globally: `claude mcp add cron -s user`
- 10 tools matching HTTP API endpoints

## 2026-02-16: AppContext Refactoring
- Moved from module-level singletons to AppContext DI pattern
- Enables in-memory DuckDB testing via createTestContext()
- All routes/services accept ctx as first param

## 2026-02-16: LaunchAgent
- Server runs as macOS LaunchAgent (com.fn.cron-server)
- RunAtLoad + KeepAlive for always-on operation
- Logs to data/launchd-{stdout,stderr}.log

## 2026-02-17: PATCH API
- Added PATCH /jobs/:id for partial updates
- Expression changes trigger cron reschedule automatically

## 2026-02-17: Max Budget Removal
- User is on Max plan (subscription, not per-token billing)
- maxBudget set to null for all jobs — no API cost limits needed
