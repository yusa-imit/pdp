# Project Context

## Current Status

### Completed
- [x] HTTP REST API (health, jobs CRUD, pause/resume/trigger, runs, logs)
- [x] PATCH /jobs/:id for partial updates
- [x] DuckDB persistence (jobs + runs tables)
- [x] croner scheduling with pause/resume
- [x] Claude Code CLI runner with timeout + concurrency guard
- [x] Log streaming to per-run files
- [x] MCP stdio server (10 tools)
- [x] AppContext DI pattern for testability
- [x] Test suite (36 tests: runner, scheduler, routes)
- [x] LaunchAgent for always-on operation
- [x] CLAUDE.md + memory system

### Active Jobs
| Name | Schedule | Directory | Model |
|------|----------|-----------|-------|
| zr-dev-v1 | `0 */3 * * *` (3h) | ~/Desktop/codespace/zr | sonnet |
| zoltraak-dev-v1 | `0 */5 * * *` (5h) | ~/Desktop/codespace/zoltraak | sonnet |

### Potential Next Steps
- [ ] Web dashboard (job status, run history, log viewer)
- [ ] Webhook notifications (generic, beyond Discord)
- [ ] Job dependency chains (run B after A completes)
- [ ] Run cost tracking / analytics
- [ ] E2E tests with mock Claude process
- [ ] API authentication
- [ ] Job templates / presets
