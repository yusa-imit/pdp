# Architecture

## System Design

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  MCP stdio   │────▶│  HTTP API    │────▶│  Services    │
│  (mcp.ts)    │     │  (server.ts) │     │  scheduler   │
└─────────────┘     │  routes/*    │     │  runner      │
                    └──────────────┘     └──────┬───────┘
                                                │
                            ┌───────────────────┼───────────────┐
                            ▼                   ▼               ▼
                    ┌──────────────┐   ┌──────────────┐   ┌──────────┐
                    │  DuckDB      │   │  croner      │   │ Bun.spawn│
                    │  (data/cron  │   │  (scheduler) │   │ (claude) │
                    │   .db)       │   │              │   │          │
                    └──────────────┘   └──────────────┘   └──────────┘
```

## Key Design Decisions

### AppContext DI Pattern
All services and routes receive `AppContext` as first param instead of importing module-level singletons. This enables in-memory DuckDB testing via `createTestContext()`.

### MCP as HTTP Client
The MCP server (`mcp.ts`) is a thin stdio wrapper that calls the HTTP API on localhost:3000. No business logic lives in MCP — this keeps a single source of truth and avoids dual maintenance.

### DuckDB over SQLite
Chosen for analytical query potential on run history. Trade-off: single-process access means CLI queries require stopping the server.

### Log File Streaming
Runner streams stdout/stderr to per-run log files using `Bun.file().writer()` with async iterators. Each run gets a unique log file: `job-{id}-{timestamp}.log`.

### Concurrency Guard
`isRunning` flag on CronJob prevents the same job from running concurrently. If a cron fires while a previous run is still active, it skips with a log message.

## Data Flow

1. **Cron fires** → croner calls `runJob(ctx, job)`
2. **Runner** → inserts run record (status=running), spawns `claude -p ...` with timeout
3. **Process completes** → updates run record with exit_code, duration, status
4. **API query** → reads from DuckDB, joins with in-memory job state
