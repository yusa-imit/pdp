# Cron Server API

Claude Code 개발 프로세스를 스케줄링하고 실행하는 HTTP API 서버.
각 잡은 cron 표현식에 따라 `claude -p` (비대화형 모드)를 실행한다.

- Base URL: `http://localhost:3000`
- Content-Type: `application/json`
- 포트는 환경변수 `PORT`로 변경 가능
- 잡과 실행 이력은 DuckDB (`cron.db`)에 저장되며, 서버 재시작 시 자동 로드된다

## 보안 (CSRF)

- `GET`이 아닌 모든 요청은 `Origin` 또는 `Sec-Fetch-Site` 헤더를 포함하면 무조건 `403 { "error": "browser origins are not allowed" }`으로 거부된다. 두 헤더 모두 브라우저의 fetch/XHR/폼 제출이 자동으로 붙이며 페이지 스크립트가 지울 수 없는 값이라, 이 규칙은 곧 "브라우저에서 보낸 상태 변경 요청은 전부 거부"를 뜻한다. `curl`, MCP stdio 클라이언트, `jobs.py` 같은 비-브라우저 클라이언트는 두 헤더를 보내지 않으므로 영향받지 않는다.
- 요청 본문을 읽는 라우트(`POST /jobs`, `PATCH /jobs/:id`)는 `Content-Type: application/json`이 아니면 `400`을 반환한다. 본문이 없는 액션(`/trigger`, `/pause`, `/resume`, `DELETE /jobs/:id`)은 이 검사 대상이 아니다.

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
| dailyBudgetUsd | number \| null | X | `null` | 하루(로컬 자정 기준) 누적 비용 상한(USD). 지정 시, 스케줄 실행 직전 해당 잡의 오늘 `runs.cost_usd` 합계가 이 값 이상이면 `claude`를 spawn하지 않고 `status="skipped"`, `error="daily budget reached"`인 run row만 기록하고 종료한다. `maxBudget`(`--max-budget-usd`, 세션당 상한)과는 별개이며 값은 양수여야 함(0 이하는 400) |
| extraArgs | string[] | X | `[]` | claude argv에 프롬프트 바로 앞에 그대로(verbatim) 전달할 추가 인자. `-p`, `--print`, `--output-format`, `--model`, `--permission-mode`, `--max-budget-usd`, `--allowedTools`, `--append-system-prompt`는 job이 이미 소유한 플래그라 지정할 수 없음(400). 배열의 각 원소는 비어있지 않은 문자열이어야 하며, 마지막 원소가 값이 필요한 플래그(`--add-dir`, `--settings`, `--append-system-prompt-file`, `--effort`, `--model`)면 거부됨(프롬프트가 그 값으로 삼켜지는 것을 방지) |

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

## PATCH /jobs/:id

잡의 설정을 부분 업데이트한다. 변경할 필드만 전달하면 된다.
`expression`을 변경하면 cron 스케줄이 자동으로 재설정된다.

**Request Body** — 변경할 필드만 포함

```json
{
  "maxBudget": null,
  "timeoutMs": 1800000
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| name | string | 잡 이름 |
| expression | string | cron 표현식 (변경 시 스케줄 재설정) |
| prompt | string | Claude Code 프롬프트 |
| cwd | string | 실행 디렉토리 |
| model | string | 사용 모델 |
| permissionMode | string | 권한 모드 |
| maxBudget | number \| null | API 비용 제한 (null = 무제한) |
| timeoutMs | number | 타임아웃 (ms) |
| allowedTools | string[] | 허용 도구 목록 |
| appendSystemPrompt | string | 추가 시스템 프롬프트 |
| extraArgs | string[] | claude argv에 프롬프트 바로 앞에 전달할 추가 인자. 검증 규칙은 위 POST /jobs 참고 |

**Response 200** — 업데이트된 잡 객체

**Response 400**

```json
{ "error": "Invalid cron expression" }
```

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

**Response 200** — 잡 객체 (scheduled=false, isPaused=true)

---

## POST /jobs/:id/resume

일시정지된 잡의 스케줄을 재개한다.

**Response 200** — 잡 객체 (scheduled=true, isPaused=false)

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
  "dailyBudgetUsd": null,
  "extraArgs": [],
  "scheduled": true,
  "isPaused": false,
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
| dailyBudgetUsd | number \| null | 하루 누적 비용 상한 (USD). `null`이면 무제한. 자세한 동작은 위 POST /jobs 참고 |
| extraArgs | string[] | claude argv에 프롬프트 바로 앞에 그대로 전달되는 추가 인자 |
| scheduled | boolean | 스케줄 활성 여부. `!isPaused && instance가 stop되지 않음`과 동일 |
| isPaused | boolean | pause/resume으로 제어되는 일시정지 상태. 서버 재시작 후에도 유지됨(DB에 영속) |
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
2. 실행 직전 동시 실행 제한(전역 `MAX_PARALLEL_JOBS`)과 `dailyBudgetUsd`(설정된 경우, 오늘 누적 `cost_usd` 합계)를 확인한다. 둘 중 하나라도 걸리면 `claude`를 spawn하지 않고 `status="skipped"` run row만 기록한다.
3. 실행 시 `claude -p --permission-mode <permissionMode> --model <model> "<prompt>"` 명령이 자신만의 프로세스 그룹(detached)으로 `cwd` 디렉토리에서 실행된다.
4. 같은 잡이 이미 실행 중이면 중복 실행을 건너뛴다 (concurrency guard).
5. 모든 실행 결과는 DuckDB `runs` 테이블에 기록되고, 로그 파일은 `./logs/`에 보존된다.
6. 타임아웃 초과 시 프로세스 그룹 전체에 SIGTERM을 보내고, 10초 내 종료되지 않으면 SIGKILL로 강제 종료한다 — `claude`가 띄운 자식 프로세스(npm 스크립트, 테스트 러너 등)까지 함께 정리되어 고아 프로세스가 남지 않는다.
7. 실행 상태: `running` → `success` (exit 0) 또는 `failed` (exit != 0 / timeout / error) 또는 `skipped` (동시 실행 제한 / 일일 예산 초과)

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

# 잡 설정 변경 (부분 업데이트)
curl -X PATCH http://localhost:3000/jobs/1 \
  -H "Content-Type: application/json" \
  -d '{"maxBudget": null, "timeoutMs": 1800000}'

# cron 스케줄 변경
curl -X PATCH http://localhost:3000/jobs/1 \
  -H "Content-Type: application/json" \
  -d '{"expression": "0 */6 * * *"}'

# 잡 삭제
curl -X DELETE http://localhost:3000/jobs/1
```
