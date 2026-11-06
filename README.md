# euta-claude-plugin

euta(End-User Test Automation)용 **Claude Code 플러그인**과 로컬 **marketplace** 를 담은 레포다. 설계 근거: `euta-workspace/40.설계/ADR_009_Claude-Code-플러그인.md`.

## 플러그인이 하는 일

| 구성 | 내용 |
|---|---|
| MCP 서버 `euta` | euta-engine 의 stdio MCP 서버(도구 13개)를 띄운다. 스크립트 검증·실행·결과 조회, 브라우저 탐색 세션 → YAML 내보내기 |
| skill `write-test-script` | 실제 사용자처럼 앱을 한 스텝씩 조작(`session_open` → `session_step`/`session_snapshot`)해 YAML 테스트 스크립트를 만들고 `validate_script` 로 검증 |
| skill `cloud-test-script` | euta cloud 원격 MCP(`euta-cloud`, 아래 "euta cloud 연결")로 클라우드 프로젝트의 스크립트를 읽기 → 고치기 → 검증 → 저장 → 실행. `read_script` 다음에 `save_script`(기준 버전), 프로젝트 테스트 규칙 따르기, 충돌·권한 오류 처리 |
| skill `analyze-test-run` | `run_script` → `get_run` → `get_screenshot`/`get_artifact` 로 실패·콘솔/네트워크 오류·느린 지표·시각 차이·다운로드 검사를 정리하고 다음 할 일을 제안 |
| hooks | 데스크톱 앱(euta-app) 안에서 실행될 때만 Claude Code 이벤트를 앱으로 전달. 앱 밖에서는 아무것도 하지 않는다 |

Claude 에서 도구 이름은 `mcp__plugin_euta_euta__run_script` 형태로 보인다.

## 준비물

- Node.js 22.13 이상 (`node` 가 PATH 에 있어야 한다 — MCP 서버와 hook 모두 `node` 로 실행)
- Claude Code 2.1.283 이상에서 검증함
- 빌드된 euta-engine과 브라우저

```bash
cd euta-engine
pnpm install && pnpm -r build
pnpm euta install-browsers          # 처음 한 번 (chromium)
```

## 설치

```bash
# 1) 이 레포를 marketplace 로 등록 (절대 경로)
claude plugin marketplace add /abs/path/euta-claude-plugin

# 2) 플러그인 설치 — 엔진 경로 등은 --config 로 줄 수 있다 (생략 가능, 아래 "설정" 참고)
claude plugin install euta@euta-tools \
  --config engine_dir=/abs/path/euta-engine \
  --config secrets_file=/abs/path/outside-repo/euta-secrets.json
```

Claude Code 안에서는 `/plugin marketplace add …` · `/plugin install euta@euta-tools` 로도 된다. 옵션은 언제든 `/plugin configure euta@euta-tools` 로 설정·변경한다. 로컬 폴더 marketplace 의 플러그인은 복사되지 않고 **제자리에서 로드**되므로, 이 레포를 고치면 다음 세션 또는 `/reload-plugins` 에 반영된다.

이미 `claude mcp add euta …` 로 엔진을 수동 등록했다면 도구가 두 벌 보이니 `claude mcp remove euta` 로 지운다.

## 설정

| 플러그인 옵션 (`userConfig`) | 환경변수 | 의미 | 우선순위 · 기본값 |
|---|---|---|---|
| `engine_dir` | `EUTA_ENGINE_DIR` | 빌드된 euta-engine 폴더 | 옵션 > 환경변수 > 이 레포 옆의 `../euta-engine` |
| `runs_dir` | `EUTA_RUNS_DIR` | 실행 결과·`index.sqlite` 위치 | 환경변수 > 옵션 > `~/.euta/runs` |
| `secrets_file` | `EUTA_SECRETS_FILE` | secrets 파일(JSON 또는 .env) | 환경변수 > 옵션 > 없음 |
| — | `EUTA_APP_EVENTS_URL` · `EUTA_APP_EVENTS_TOKEN` | MCP 서버 → 앱 실행 이벤트 전달 (앱이 설정) | 없으면 끔 |
| — | `EUTA_APP_URL` · `EUTA_APP_TOKEN` | hook → 앱 이벤트 전달 (앱이 설정) | 없으면 끔 |

그 밖의 엔진 변수(`EUTA_RUN_HEADLESS` · `EUTA_SESSION_HEADLESS` · `EUTA_STEP_IMAGE` · `EUTA_BASELINE_DIR`)는 Claude Code 를 띄운 셸 환경에서 그대로 전달된다(`euta-engine/packages/mcp-server/README.md`).

`euta-workspace`·`euta-engine`·`euta-claude-plugin` 을 같은 상위 폴더에 두는 개발 배치에서는 `engine_dir` 없이도 엔진을 찾는다. 엔진을 못 찾으면 MCP 서버가 시작하지 않고, `claude --debug` 로그에 `[euta-mcp-launch] euta engine not found …` 가 남는다.

## euta cloud 연결 (원격 MCP, 선택)

euta cloud 서버의 공유 프로젝트를 Claude 에서 다루려면 원격 MCP 서버 `euta-cloud` 를 **직접 한 번 추가**한다. 플러그인은 이 서버를 자동으로 넣지 않는다 — 주소·토큰을 비워 둔 원격 서버는 Claude Code 가 `/mcp`·`claude mcp list` 에 "✘ Failed to connect — URL is unset or invalid" 로 계속 보여 주므로, 클라우드를 안 쓰는 사용자에게 오류처럼 보이지 않게 선택 사항으로 둔다(Claude Code 2.1.305 에서 확인).

1. euta cloud 웹 **내 설정 > 토큰** 에서 개인 토큰을 발급한다(권한 `읽기` 또는 `읽기·쓰기`, 원문은 발급 직후 한 번만 보임).
2. 등록 (euta cloud 서버에 접속할 수 있는 네트워크에서):

   ```bash
   claude mcp add --transport http -s user euta-cloud https://<euta cloud>/mcp \
     --header "Authorization: Bearer euta_…"
   ```

   토큰은 셸 기록에 남지 않게 환경변수로 넘겨도 된다(`--header "Authorization: Bearer $EUTA_CLOUD_TOKEN"`).
3. 확인: `claude mcp list` → `euta-cloud: https://<euta cloud>/mcp (HTTP) - ✔ Connected`.
   - 토큰이 틀리거나 만료·폐기됐으면 `✘ Failed to connect — Server rejected the configured Authorization header (HTTP 401)…` 가 보인다. 웹에서 새 토큰을 발급해 `claude mcp remove euta-cloud -s user` 후 다시 추가한다.
4. 도구는 `mcp__euta-cloud__*` 로 보인다: `list_projects` · `get_project` · `list_scripts` · `read_script` · `get_schema` · `validate_script` · `save_script` · `run_script` · `get_run` · `list_runs` · `get_screenshot` · `get_artifact` · `cancel_run` · `list_schedules`. 탐색 세션(`session_*`)·예약 변경·환경/테스트 계정/구성원 변경은 없다(웹·앱에서).

- 권한은 토큰 권한과 프로젝트 역할 중 좁은 쪽이다 — 읽기 토큰이나 보기 역할이면 쓰기 도구가 "권한 없음" 을 돌려준다. 저장·실행은 작업 로그에 "AI — <내 이름> (<토큰 이름>)" 으로 남는다.
- 호출 상한은 토큰당 분당 120회(HTTP 요청 단위). 넘으면 HTTP 429.
- 테스트 계정 값은 어떤 도구 결과에도 나오지 않는다(이름만). 스크립트에는 `${secrets.NAME}` 을 `fill`/`type` 값에만 쓴다.

## secrets

- 스크립트에는 `${secrets.USER_PASSWORD}` 처럼 **이름만** 쓴다. 값은 secrets 파일에만 두고, 모든 도구 결과에서 `***` 로 가려진다. Claude 에게 값을 알려 줄 필요가 없고, skill 도 값을 묻지 않도록 되어 있다.
- secrets 파일은 **어떤 레포에도 넣지 않는다**(예: `~/.config/euta/secrets.json`). 형식은 `{"USER_EMAIL": "...", "USER_PASSWORD": "..."}` 또는 `.env` 의 `NAME=value`.
- 파일을 고친 뒤에는 Claude Code 세션을 새로 시작하거나 `/mcp` 에서 서버를 다시 연결해야 반영된다.
- 자격증명처럼 보이는 이름을 `${env.X}` 로 쓰면 서버가 실행 전에 거부한다.

## 앱 안 / 앱 밖 동작

| | 앱(euta-app) 터미널 패널에서 실행한 `claude` | 일반 터미널의 `claude` |
|---|---|---|
| MCP 도구·skills | 같음 | 같음 |
| hooks | `SessionStart` · `UserPromptSubmit` · `PreToolUse` · `PostToolUse` · `PostToolUseFailure` · `Notification` · `SubagentStart` · `SubagentStop` · `Stop` · `StopFailure` · `SessionEnd` 입력 JSON 을 그대로 `POST ${EUTA_APP_URL}/hooks/claude` (`Authorization: Bearer ${EUTA_APP_TOKEN}`) | `EUTA_APP_URL` 이 없으므로 아무것도 보내지 않고 즉시 종료 |
| 실행 이벤트 | `EUTA_APP_EVENTS_URL` 이 있으면 MCP 서버가 run/step 이벤트를 앱으로 전달 | 끔 |

hook 은 항상 조용하다 — 출력 없음, 종료 코드 0, 최대 1초, 결정(decision) 출력 없음. `SessionEnd` 외의 hook 은 `async` 로 돌아 Claude 를 기다리게 하지 않는다. 대상 URL 은 loopback(`127.0.0.1` · `localhost` · `::1`)만 허용한다.

## 개발

```bash
npm test          # hook 전달기 + MCP 기동(initialize · tools/list = 13) 테스트, 의존성 없음
npm run validate  # claude plugin validate (플러그인 · marketplace)
```

```
.claude-plugin/marketplace.json     marketplace "euta-tools"
plugins/euta/
  .claude-plugin/plugin.json        매니페스트 + userConfig
  .mcp.json                         MCP 서버 "euta" → scripts/mcp-launch.mjs
  hooks/hooks.json                  이벤트 → scripts/hook-forward.mjs
  scripts/                          mcp-launch.mjs · launch-plan.mjs · hook-forward.mjs (Node 내장 모듈만)
  skills/                           write-test-script · analyze-test-run · cloud-test-script
test/                               node:test
```

## 제거

```bash
claude plugin uninstall euta@euta-tools
claude plugin marketplace remove euta-tools
```

실행 결과(`runs_dir`, 기본 `~/.euta/runs`)와 secrets 파일은 지워지지 않는다. 필요하면 직접 지운다.
