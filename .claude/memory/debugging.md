# Debugging Solutions

## DuckDB VARCHAR[] Empty Array Error
- **Symptom**: `Conversion Error: Type VARCHAR with value '' can't be cast to VARCHAR[]`
- **Cause**: DuckDB can't handle empty arrays in `VARCHAR[]` columns
- **Fix**: Changed column to `TEXT`, store as `JSON.stringify(array)`, parse with `JSON.parse()`
- **Prevention**: Always use TEXT + JSON for array-like data in DuckDB

## DuckDB NOT NULL Constraint on ID
- **Symptom**: `NOT NULL constraint failed: jobs.id` on INSERT
- **Cause**: DuckDB doesn't auto-increment `INTEGER PRIMARY KEY` like SQLite
- **Fix**: `CREATE SEQUENCE jobs_seq START 1` + `DEFAULT nextval('jobs_seq')` on id column
- **Prevention**: Always use explicit sequences for auto-increment in DuckDB

## DuckDB Single Process Access
- **Symptom**: `Connection Error: Connection was never established or has been closed already`
- **Cause**: DuckDB file is locked by the running server process
- **Fix**: Stop server (launchctl unload) before running CLI queries, then restart
- **Prevention**: Use the HTTP API for queries when server is running

## MCP SDK Import Paths
- **Symptom**: `Cannot find module @modelcontextprotocol/sdk/server`
- **Cause**: SDK uses wildcard exports, Bun needs explicit `.js` extension
- **Fix**: Import from `@modelcontextprotocol/sdk/server/mcp.js` and `.../stdio.js`
- **Prevention**: Always use full subpath with `.js` extension for MCP SDK imports

## Bun Crash on DuckDB Close
- **Symptom**: Segfault after DuckDB operations complete in one-off scripts
- **Cause**: Bun + DuckDB native module cleanup race condition
- **Fix**: Non-blocking — operations complete before crash, data is persisted
- **Prevention**: Use the HTTP API instead of one-off scripts when possible
