# cron

Claude Code 개발 프로세스를 자동으로 스케줄링하고 실행하는 cron 서버.

등록된 잡이 cron 표현식에 따라 `claude -p` (비대화형 모드)를 자동 실행하고, 실행 이력과 로그를 DuckDB에 기록한다.

## Quick Start

```bash
# 의존성 설치
bun install

# 서버 시작 (포트 3000)
bun start

# 개발 모드 (watch)
bun dev

# 테스트
bun test
```

## API

```bash
# 서버 상태
curl http://localhost:3000/health

# 잡 등록
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-dev-cycle",
    "expression": "0 */3 * * *",
    "prompt": "개발 사이클을 돌려줘",
    "cwd": "/path/to/project"
  }'

# 잡 목록
curl http://localhost:3000/jobs

# 잡 수정
curl -X PATCH http://localhost:3000/jobs/1 \
  -H "Content-Type: application/json" \
  -d '{"expression": "0 */6 * * *"}'

# 수동 실행
curl -X POST http://localhost:3000/jobs/1/trigger

# 실행 이력
curl http://localhost:3000/jobs/1/runs

# 로그 확인
curl http://localhost:3000/jobs/1/logs

# 일시정지 / 재개
curl -X POST http://localhost:3000/jobs/1/pause
curl -X POST http://localhost:3000/jobs/1/resume

# 삭제
curl -X DELETE http://localhost:3000/jobs/1
```

전체 API 문서: [docs/API.md](docs/API.md)

## MCP

Claude Code에서 직접 cron 서버를 제어할 수 있는 MCP 도구 제공.

```bash
# MCP 서버 등록 (전역, 1회만)
claude mcp add cron -s user -- bun run src/mcp.ts
```

등록 후 Claude Code 세션에서 `list_jobs`, `create_job`, `update_job`, `trigger_job` 등 11개 도구 사용 가능.

전체 MCP 문서: [docs/MCP.md](docs/MCP.md)

## Always-On (LaunchAgent)

macOS LaunchAgent로 상시 실행:

```bash
# 시작
launchctl load ~/Library/LaunchAgents/com.fn.cron-server.plist

# 중지
launchctl unload ~/Library/LaunchAgents/com.fn.cron-server.plist

# 상태 확인
launchctl list | grep cron-server
```

## Stack

- **Runtime**: [Bun](https://bun.sh)
- **Scheduler**: [croner](https://github.com/hexagon/croner) v10
- **Database**: [DuckDB](https://duckdb.org) (embedded)
- **MCP**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) v1.26

## Project Structure

```
src/
├── index.ts           # 부트스트랩
├── server.ts          # HTTP 라우터
├── db.ts              # DuckDB 팩토리
├── types.ts           # 공유 타입
├── mcp.ts             # MCP stdio 서버
├── routes/            # HTTP 핸들러
├── services/          # 비즈니스 로직
└── lib/               # 유틸리티
tests/                 # bun:test 테스트
data/                  # DB + 로그
docs/                  # API, MCP 문서
```
