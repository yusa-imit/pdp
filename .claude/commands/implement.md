Implement a feature or fix following the autonomous development protocol:

1. **Understand**: Read CLAUDE.md, relevant memory files, and source code
2. **Plan**: Design the approach, identify files to change
3. **Implement**: Write the code following project conventions (AppContext DI, named exports, etc.)
4. **Test**: Add/update tests in `tests/`, run `bun test` — all must pass
5. **Review**: Check for DuckDB quirks, error handling, security issues
6. **Memory**: Update `.claude/memory/` if new patterns or decisions emerged
7. **Report**: Summarize what was done, what changed, what to do next

Input: $ARGUMENTS (feature description or issue to fix)
