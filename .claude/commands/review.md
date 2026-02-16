Review recent code changes for quality and correctness:

1. Run `git diff` to see unstaged changes, or `git diff HEAD~1` for the last commit
2. Check each change against the review checklist:
   - AppContext DI used properly?
   - Error handling with correct HTTP status codes?
   - DuckDB queries parameterized? Arrays stored as JSON text?
   - New code has test coverage?
   - No security issues (command injection, unvalidated input)?
3. Output findings as:
   - `[CRITICAL]` — must fix before commit
   - `[WARNING]` — should fix
   - `[SUGGESTION]` — nice to have
