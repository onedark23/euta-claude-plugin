---
name: write-test-script
description: Create or update an euta end-user test script (YAML) for a web app by exploring it in a real browser like a user would — open an euta session, act one step at a time, read the page's accessibility snapshot, then export the passing steps to YAML and validate them. Use for requests to write, record, generate, or fix a browser/E2E/user-scenario test, login or checkout flow test, or euta script.
when_to_use: Trigger phrases such as "테스트 스크립트 만들어줘", "이 사이트 로그인 시나리오 테스트 작성", "사용자처럼 눌러보고 YAML 로 저장", "E2E 테스트 녹화", "euta 스크립트 고쳐줘", "write a test for this page", "record a user flow".
allowed-tools: mcp__plugin_euta_euta__get_schema mcp__plugin_euta_euta__validate_script mcp__plugin_euta_euta__session_snapshot mcp__plugin_euta_euta__session_screenshot mcp__plugin_euta_euta__get_page_map mcp__plugin_euta_euta__check_script_targets
---

# Write an euta test script by exploring the app

Tools below are on the `euta` MCP server (`mcp__plugin_euta_euta__*`). DSL reference: read the MCP resource `euta://docs/dsl-cheatsheet` first; call `get_schema` when you need an exact field. Always pass **absolute** file paths (`savePath`, `path`): the server's working directory is not necessarily the project.

## Secrets rule (non-negotiable)

- Credentials are always written as `${secrets.NAME}` (e.g. `${secrets.USER_PASSWORD}`). The value comes from the user's secrets file (plugin option `secrets_file` or `EUTA_SECRETS_FILE`) and is masked as `***` in every result.
- Never ask the user to paste a password, token, or card number into the chat. Ask only for the **name** to use, and tell them to add `NAME=value` (or `"NAME": "value"` in JSON) to their secrets file outside any repository, then restart the session so the server reloads it.
- If a user pastes a secret anyway, do not repeat it and do not put it in a script or step; use a `${secrets.NAME}` reference instead.
- Never use `${env.X}` for credential-like names — the server rejects it before running.

## Workflow

1. **Agree on the scenario**: start URL (base URL), the user journey in plain steps, what "success" looks like, and which secret names are needed. Ask where to save the YAML (default suggestion: `tests/<kebab-name>.yaml` in the project).
2. **Open a session**: `session_open { baseUrl, name }`. It opens a visible browser so the user can watch (headless only if they ask). Keep the returned `sessionId`.
3. **Explore one step at a time**:
   - `session_step { sessionId, step: { goto: "/" } }`, then `session_snapshot { sessionId }` to read roles, names, and labels.
   - Build targets from the snapshot, preferring user-facing attributes: `{ role, name }` > `{ label }` > `{ text }` > `{ placeholder }` > `{ testId }` > CSS. Add `nth` only when several elements match.
   - Send exactly one DSL step per `session_step` call (`click`, `fill`, `select`, `press`, `expectDownload`, ...). Give important steps a short `name`.
   - After each meaningful action add an `expect` step that proves the outcome (`url`, `visible`, `text`, `count`). A script without assertions only proves that clicks did not crash.
   - If a step fails, take a fresh `session_snapshot` (or `session_screenshot`) and retry with a better target or a `wait: { for: ... }`; failed steps are not exported. Avoid fixed `wait: { ms }` unless nothing else works.
4. **Add checks the user cares about** (see the cheat sheet): `expect: { console: { errors: 0 } }`, `expect: { network: { failed: 0 } }`, `measure: [web-vitals]` with `expect: { metric: { name: LCP, max: 2.5s } }`, `expectDownload` for exports (type, minSize, `csv: { minRows }`, `contains`), `visual` for screenshots compared with a baseline.
5. **Export**: `session_export { sessionId, name, savePath }` writes the passing steps as YAML (it will not overwrite an existing file unless `overwrite: true` — ask first). Show the YAML to the user.
6. **Close**: always `session_close { sessionId }`, including when the user abandons the exploration, so evidence is finalized.
7. **Validate**: `validate_script { path }` and fix every issue. Offer to run it once with `run_script` (the `analyze-test-run` skill covers running and reading results).

## Writing without a session

If the user already describes the steps or gives an existing script to fix, you may write or edit the YAML directly — then always run `validate_script` and, when a browser is available, `run_script` to confirm it passes.

When there is a run of the site (the user's run, a failed run, or a quick draft run), do not guess targets from screenshots: read the real screen structure with `get_page_map { runId }` before writing, and check the script with `check_script_targets { runId, path }` before running — fix every `missing` / `ambiguous` / `present` target (prefer a returned candidate whose count is 1).

## Style

- `version: 1`, a clear `name`, `target: { baseUrl: ... }`; relative paths in `goto`.
- One behavior per script; keep them deterministic (no dependence on data another test creates unless stated).
- Talk to the user in their language; keep the YAML keys as defined by the DSL.
