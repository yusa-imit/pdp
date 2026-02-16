# Cron Server API

Claude Code 개발 프로세스를 스케줄링하고 실행하는 HTTP API 서버.
각 잡은 cron 표현식에 따라 `claude -p` (비대화형 모드)를 실행한다.

- Base URL: `http://localhost:3000`
- Content-Type: `application/json`
- 포트는 환경변수 `PORT`로 변경 가능
- 잡과 실행 이력은 DuckDB (`cron.db`)에 저장되며, 서버 재시작 시 자동 로드된다

---

## GET /health

서버 상태를 확인한다.

**Response 200**

```json
{
  "status": "ok",
  "jobs": 2,
  "running": 1
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| status | string | 항상 `"ok"` |
| jobs | number | 등록된 전체 잡 수 |
| running | number | 현재 실행 중인 잡 수 |

---

## POST /jobs

새로운 cron 잡을 등록한다.

**Request Body**

```json
{
  "name": "daily-refactor",
  "expression": "0 9 * * *",
  "prompt": "src 디렉토리의 TODO 주석을 찾아서 해결해줘",
  "cwd": "/Users/fn/Desktop/codespace/my-project",
  "model": "sonnet",
  "permissionMode": "bypassPermissions",
  "maxBudget": 1.0,
  "timeoutMs": 600000,
  "allowedTools": ["Bash", "Edit", "Read", "Write", "Glob", "Grep"],
  "appendSystemPrompt": "항상 한국어로 커밋 메시지를 작성해"
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| name | string | O | - | 잡 이름 (식별용) |
| expression | string | O | - | cron 표현식. 초 단위 지원 (`*/5 * * * * *` = 5초마다) |
| prompt | string | O | - | Claude Code에 전달할 프롬프트 |
| cwd | string | O | - | Claude Code가 실행될 작업 디렉토리 (절대경로) |
| model | string | X | `"sonnet"` | 사용할 모델 (`"haiku"`, `"sonnet"`, `"opus"`) |
| permissionMode | string | X | `"bypassPermissions"` | 권한 모드. `--permission-mode`로 전달됨. 선택: `"default"`, `"acceptEdits"`, `"bypassPermissions"`, `"plan"` |
| maxBudget | number | X | `null` | 최대 API 비용 (USD). `--max-budget-usd`로 전달됨 |
| timeoutMs | number | X | `600000` | 실행 타임아웃 (ms). 기본 10분 |
| allowedTools | string[] | X | `[]` | 허용할 도구 목록. `--allowedTools`로 전달됨. 빈 배열이면 제한 없음 |
| appendSystemPrompt | string | X | `""` | 시스템 프롬프트에 추가할 텍스트. `--append-system-prompt`로 전달됨 |

**cron 표현식 형식**

```
┌──────────── 초 (0-59, 선택)
│ ┌────────── 분 (0-59)
│ │ ┌──────── 시 (0-23)
│ │ │ ┌────── 일 (1-31)
│ │ │ │ ┌──── 월 (1-12)
│ │ │ │ │ ┌── 요일 (0-7, 0과 7은 일요일)
│ │ │ │ │ │
* * * * * *
```

| 표현식 | 의미 |
|--------|------|
| `* * * * *` | 매분 |
| `0 */6 * * *` | 6시간마다 |
| `0 9 * * 1-5` | 평일 오전 9시 |
| `0 0 * * *` | 매일 자정 |
| `*/30 * * * * *` | 30초마다 |

**Response 201**

잡 객체를 반환한다. (아래 잡 객체 형식 참고)

**Response 400**

```json
{ "error": "name, expression, prompt, cwd are required" }
```

```json
{ "error": "Invalid cron expression" }
```

---

## GET /jobs

등록된 모든 잡 목록을 조회한다.

**Response 200**

```json
{
  "jobs": [ /* 잡 객체 배열 */ ]
}
```

---

## GET /jobs/:id

특정 잡의 상세 정보를 조회한다.

**Response 200** — 잡 객체

**Response 404**

```json
{ "error": "Job not found" }
```

---

## DELETE /jobs/:id

잡을 삭제한다. 스케줄이 중지되고 목록에서 제거된다.

**Response 200**

```json
{ "message": "Job deleted" }
```

**Response 404**

```json
{ "error": "Job not found" }
```

---

## POST /jobs/:id/trigger

잡을 즉시 수동 실행한다. 백그라운드에서 실행되며 응답은 즉시 반환된다.
이미 실행 중인 잡은 409를 반환한다.

**Response 200**

```json
{ "message": "Job triggered", "jobId": "1" }
```

**Response 409**

```json
{ "error": "Job is already running" }
```

---

## POST /jobs/:id/pause

잡의 스케줄을 일시정지한다. 현재 실행 중인 프로세스에는 영향 없음.

**Response 200** — 잡 객체 (scheduled=false)

---

## POST /jobs/:id/resume

일시정지된 잡의 스케줄을 재개한다.

**Response 200** — 잡 객체 (scheduled=true)

---

## GET /jobs/:id/runs

해당 잡의 실행 이력을 조회한다. DuckDB에 저장된 전체 이력을 페이지네이션으로 반환한다.

**Query Parameters**

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| limit | number | X | `20` | 반환할 최대 건수 |
| offset | number | X | `0` | 건너뛸 건수 |
| status | string | X | - | 상태 필터 (`"success"`, `"failed"`, `"running"`) |

**Response 200**

```json
{
  "runs": [
    {
      "id": 3,
      "jobId": 2,
      "startedAt": "2026-02-16T15:00:00.000Z",
      "finishedAt": "2026-02-16T15:12:34.000Z",
      "exitCode": 0,
      "durationMs": 754000,
      "logFile": "./logs/job-2-2026-02-16T15-00-00-000Z.log",
      "error": null,
      "status": "success"
    }
  ],
  "total": 15,
  "limit": 20,
  "offset": 0
}
```

---

## GET /jobs/:id/logs

마지막 실행의 로그를 텍스트로 반환한다.

**Query Parameters**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| run | number | X | 특정 실행 ID의 로그. 생략 시 마지막 실행 로그 |

**Response 200** — `Content-Type: text/plain`

로그 파일 내용 전체를 반환한다.

**Response 404**

```json
{ "error": "No runs yet" }
```

---

## 잡 객체 형식

모든 잡 조회/생성 응답에서 사용되는 공통 구조:

```json
{
  "id": "1",
  "name": "daily-refactor",
  "expression": "0 9 * * *",
  "prompt": "src 디렉토리의 TODO 주석을 찾아서 해결해줘",
  "cwd": "/Users/fn/Desktop/codespace/my-project",
  "model": "sonnet",
  "permissionMode": "bypassPermissions",
  "maxBudget": 1.0,
  "timeoutMs": 600000,
  "allowedTools": ["Bash", "Edit", "Read", "Write", "Glob", "Grep"],
  "appendSystemPrompt": null,
  "scheduled": true,
  "isRunning": false,
  "nextRun": "2026-02-17T00:00:00.000Z",
  "lastRun": {
    "startedAt": "2026-02-16T00:00:00.000Z",
    "finishedAt": "2026-02-16T00:03:22.000Z",
    "exitCode": 0,
    "durationMs": 202000,
    "logFile": "./logs/job-1-2026-02-16T00-00-00-000Z.log",
    "error": null
  },
  "runCount": 5,
  "createdAt": "2026-02-15T10:00:00.000Z"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 잡 고유 ID (자동 증가) |
| name | string | 잡 이름 |
| expression | string | cron 표현식 |
| prompt | string | Claude Code에 전달되는 프롬프트 |
| cwd | string | 실행 디렉토리 |
| model | string | 사용 모델 |
| permissionMode | string | 권한 모드 |
| maxBudget | number \| null | API 비용 제한 (USD) |
| timeoutMs | number | 타임아웃 (ms) |
| allowedTools | string[] | 허용된 도구 목록 |
| appendSystemPrompt | string \| null | 추가 시스템 프롬프트 |
| scheduled | boolean | 스케줄 활성 여부 (pause/resume으로 제어) |
| isRunning | boolean | 현재 실행 중인지 여부 |
| nextRun | string \| null | 다음 예정 실행 시각 (ISO 8601) |
| lastRun | object \| null | 마지막 실행 결과 (아래 참고) |
| runCount | number | 총 실행 횟수 |
| createdAt | string | 잡 생성 시각 (ISO 8601) |

### lastRun 객체

| 필드 | 타입 | 설명 |
|------|------|------|
| startedAt | string | 실행 시작 시각 |
| finishedAt | string | 실행 종료 시각 |
| exitCode | number \| null | 프로세스 종료 코드. 타임아웃 시 null |
| durationMs | number | 실행 소요 시간 (ms) |
| logFile | string | 로그 파일 경로 |
| error | string \| null | 에러 메시지. 정상 종료 시 null |

---

## 동작 방식

1. 잡이 등록되면 cron 표현식에 따라 자동으로 스케줄링된다.
2. 실행 시 `claude -p --permission-mode <permissionMode> --model <model> "<prompt>"` 명령이 `cwd` 디렉토리에서 실행된다.
3. 같은 잡이 이미 실행 중이면 중복 실행을 건너뛴다 (concurrency guard).
4. 모든 실행 결과는 DuckDB `runs` 테이블에 기록되고, 로그 파일은 `./logs/`에 보존된다.
5. 타임아웃 초과 시 프로세스가 강제 종료된다.
6. 실행 상태: `running` → `success` (exit 0) 또는 `failed` (exit != 0 / timeout / error)

---

## curl 예시

```bash
# 서버 상태 확인
curl http://localhost:3000/health

# 잡 생성
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"name":"lint-fix","expression":"0 */2 * * *","prompt":"lint 에러를 찾아서 수정해줘","cwd":"/path/to/project","model":"sonnet","maxBudget":0.5}'

# 잡 목록 조회
curl http://localhost:3000/jobs

# 잡 수동 실행
curl -X POST http://localhost:3000/jobs/1/trigger

# 실행 이력 조회
curl http://localhost:3000/jobs/1/runs

# 실패한 실행만 조회
curl 'http://localhost:3000/jobs/1/runs?status=failed'

# 실행 로그 확인 (최근)
curl http://localhost:3000/jobs/1/logs

# 특정 실행의 로그 확인
curl 'http://localhost:3000/jobs/1/logs?run=3'

# 잡 일시정지
curl -X POST http://localhost:3000/jobs/1/pause

# 잡 재개
curl -X POST http://localhost:3000/jobs/1/resume

# 잡 삭제
curl -X DELETE http://localhost:3000/jobs/1
```
