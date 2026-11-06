---
name: cloud-test-script
description: Read, edit, save, and run test scripts in a shared euta cloud project through the euta-cloud MCP server (tools list_projects, get_project, read_script, validate_script, save_script, run_script, get_run …). Use when the user talks about cloud / team / shared euta projects, a script on the euta cloud server, or asks to fix and run a cloud test.
when_to_use: Trigger phrases such as "클라우드 프로젝트 스크립트 고쳐줘", "euta cloud 에서 돌려줘", "팀 프로젝트 로그인 테스트 수정", "클라우드 실행 결과 봐줘", "fix the cloud test", "run it on euta cloud".
---

# Work on an euta cloud project

Tools are on the `euta-cloud` remote MCP server (`mcp__euta-cloud__*`), which the user adds once with `claude mcp add --transport http euta-cloud https://<euta cloud>/mcp --header "Authorization: Bearer euta_…"` (see this plugin's README). If those tools are missing, tell the user to add the server; never ask for the token in the chat. They act on the server's shared projects, not on local files, and every call is checked against the token's permission and the user's project role.

## Rules

1. **Know the project first.** `list_projects` → `get_project`. Read `testRules` and follow them in every script you write or change. Environments list credential **names** only.
2. **Always `read_script` before `save_script`.** Pass the `version` you read as `baseVersion`. Omit `baseVersion` only for a brand-new path.
3. **On a conflict, nothing was saved.** The error carries the current version and source: show the user what changed, re-apply the edit on top of it, and save with the new `baseVersion`. Never overwrite blindly.
4. **Validate before saving or running.** `validate_script { projectId, source, environment? }` returns engine issues plus the cloud precheck (`runnable`). A failed validation is never saved.
5. **Credentials:** write `${secrets.NAME}` only as a `fill`/`type` value; never in `goto` URLs, `vars` or `expect`. Use names that `get_project` lists for the environment. Never ask the user for credential values — if a name is missing, tell them to add it in the euta cloud web/app (environment → 테스트 계정).
6. **Runs are asynchronous.** `run_script` returns a run id right away; poll `get_run` (every few seconds, not in a tight loop — there is a 120 calls/min limit per token) until the status is no longer `queued`/`leased`/`running`. Then read failures, `get_screenshot { runId, stepId }`, and `get_artifact { runId, file: "run.log" }`. "파일 만료" means the result files passed their retention period; the summary in `get_run` stays.
7. **Permission errors ("권한 없음")** mean a read-only token or a viewer role — tell the user; do not retry.
8. Schedules, environments, credentials and members cannot be changed through these tools — point the user to the euta cloud web or desktop app.

Talk to the user in their language; keep YAML keys as defined by the DSL (`get_schema` for exact fields).
