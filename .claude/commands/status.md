Show a dashboard of the cron server's current state:

1. **Server**: `curl -s http://localhost:3000/health` — is it running?
2. **Jobs**: `curl -s http://localhost:3000/jobs` — list all jobs with next run times
3. **Git**: `git status && git log --oneline -5` — recent changes
4. **Tests**: `bun test` — are tests passing?
5. **LaunchAgent**: `launchctl list | grep cron-server` — is daemon active?
6. **Logs**: Show last 5 lines of `data/launchd-stderr.log` if it exists

Format as a clean, readable dashboard.
