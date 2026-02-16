# MCP (Model Context Protocol) Server

cron 서버의 HTTP API를 Claude Code에서 직접 도구로 사용할 수 있게 하는 MCP stdio 서버.

## 설치

```bash
claude mcp add cron -s user -- bun run /Users/fn/Desktop/codespace/cron/src/mcp.ts
```

이후 모든 Claude Code 세션에서 `cron` MCP 도구가 사용 가능해진다.

## 구조

```
Claude Code ←→ MCP stdio ←→ HTTP localhost:3000 ←→ cron server
```

MCP 서버는 비즈니스 로직 없이 HTTP API를 호출하는 thin client다.
모든 로직은 메인 서버에 있으며, MCP는 입출력 변환만 담당한다.

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CRON_SERVER_URL` | `http://localhost:3000` | cron 서버 주소 |

## 등록된 도구 (11개)

### health
서버 상태를 확인한다.

```
입력: 없음
출력: { status, jobs, running }
```

### list_jobs
등록된 모든 잡 목록을 조회한다.

```
입력: 없음
출력: { jobs: [...] }
```

### get_job
특정 잡의 상세 정보를 조회한다.

```
입력: { id: number }
출력: 잡 객체
```

### create_job
새로운 cron 잡을 등록한다.

```
입력: {
  name: string       (필수) 잡 이름
  expression: string (필수) cron 표현식
  prompt: string     (필수) Claude Code 프롬프트
  cwd: string        (필수) 실행 디렉토리 (절대경로)
  model?: string              기본: "sonnet"
  permissionMode?: string     기본: "bypassPermissions"
  maxBudget?: number          API 비용 제한 (USD)
  timeoutMs?: number          기본: 600000 (10분)
  allowedTools?: string[]     허용 도구 목록
  appendSystemPrompt?: string 추가 시스템 프롬프트
}
출력: 생성된 잡 객체
```

### update_job
잡의 설정을 부분 업데이트한다. 변경할 필드만 전달하면 된다.

```
입력: {
  id: number         (필수) 잡 ID
  name?: string
  expression?: string       변경 시 cron 스케줄 자동 재설정
  prompt?: string
  cwd?: string
  model?: string
  permissionMode?: string
  maxBudget?: number | null  null이면 제한 없음
  timeoutMs?: number
  allowedTools?: string[]
  appendSystemPrompt?: string
}
출력: 업데이트된 잡 객체
```

### delete_job
잡을 삭제한다. 실행 이력도 함께 삭제된다.

```
입력: { id: number }
출력: { message: "Job deleted" }
```

### trigger_job
잡을 즉시 수동 실행한다.

```
입력: { id: number }
출력: { message: "Job triggered", jobId: number }
```

### pause_job
잡의 스케줄을 일시정지한다.

```
입력: { id: number }
출력: { message: "Job paused", id: number }
```

### resume_job
일시정지된 잡의 스케줄을 재개한다.

```
입력: { id: number }
출력: { message: "Job resumed", id: number }
```

### get_runs
잡의 실행 이력을 조회한다.

```
입력: {
  id: number          (필수) 잡 ID
  limit?: number       반환 건수 (기본: 20)
  offset?: number      건너뛸 건수 (기본: 0)
  status?: string      필터: "success", "failed", "running"
}
출력: { runs: [...], total, limit, offset }
```

### get_log
실행 로그를 텍스트로 반환한다.

```
입력: {
  id: number          (필수) 잡 ID
  run?: number         특정 실행 ID (생략 시 마지막 실행)
}
출력: 로그 텍스트
```

## 사용 예시

Claude Code 세션 내에서:

```
> cron 서버에 등록된 잡 목록 보여줘
→ list_jobs 도구 호출

> zr-dev-v1 잡의 스케줄을 6시간마다로 변경해줘
→ update_job { id: 2, expression: "0 */6 * * *" }

> 잡 2번의 마지막 실행 로그 보여줘
→ get_log { id: 2 }
```
