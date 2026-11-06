---
name: analyze-test-run
description: Run an euta test script (YAML) and analyze the result, or analyze a past euta run — failures with screenshots, console and network errors, slow web-vitals and response times, visual diffs, and download checks — then summarize findings with next steps. Use when asked to run, execute, re-run, check, debug, or explain an euta/E2E/browser test or test run.
when_to_use: Trigger phrases such as "테스트 돌려줘", "이 스크립트 실행하고 결과 분석", "왜 실패했어?", "지난 실행 결과 보여줘", "성능 지표 어때?", "run the login test", "why did the last run fail".
allowed-tools: mcp__plugin_euta_euta__list_runs mcp__plugin_euta_euta__get_run mcp__plugin_euta_euta__get_screenshot mcp__plugin_euta_euta__get_artifact mcp__plugin_euta_euta__validate_script
---

# Run an euta test and analyze the results

Tools below are on the `euta` MCP server (`mcp__plugin_euta_euta__*`). Secret values never appear in results (masked `***`); never ask the user for them. Pass **absolute** script paths: the server's working directory is not necessarily the project.

## 1. Get a run

- **New run**: `validate_script { path }` first; fix issues before running. Then `run_script { path }` (headless by default; pass `headed: true` if the user wants to watch, `vars`/`env` for overrides). It returns the run overview when finished.
- **Existing run**: `list_runs { limit, status?, name? }` to find it (newest first); `runId` accepts the 6-character short id.

## 2. Collect evidence

- `get_run { runId }` → steps, `failures` (with `failedExpects`), `expects`, `metrics`, `consoleErrors`, `networkFailures`, `artifacts`, `reportPath`.
- For every failed/error step: `get_screenshot { runId, stepId }` and look at the image — is the expected element missing, renamed, covered by a dialog, still loading, or is an error page shown?
- Visual checks: files `diffs/<name>.diff.png` (difference), `diffs/<name>.baseline.png`, `screenshots/visual-<name>.png` → `get_screenshot { runId, file }`. Metric `visual.<name>.diffRatio` vs the threshold. "baseline created" means the first run just recorded the reference.
- Downloads: files under `artifacts/` → `get_artifact { runId, file }` (PDFs come back as extracted text) to confirm content against the `expectDownload` conditions.
- Read other text artifacts only when they explain a failure; keep `maxBytes` modest.

## 3. Judge

Classify each failure's most likely cause, with the evidence that supports it:
- **Script drift** — target name/role changed, text changed, flow reordered → propose the corrected step.
- **Timing** — element appeared later, network-idle never settled → propose `wait: { for: ... }`, a `settle` option, or a longer `timeout`, not a fixed sleep.
- **Product bug** — error page, 4xx/5xx in `networkFailures`, JS errors in `consoleErrors`, wrong data → describe it as a bug report.
- **Environment/data** — wrong base URL, missing secret, test data absent, login locked.

Performance (flag values above these "good" limits): LCP 2.5 s, INP 200 ms, CLS 0.1, FCP 1.8 s, TTFB 0.8 s; `responseTime` above the script's own `max` or noticeably slower than earlier runs of the same script (`list_runs { name }`).

## 4. Report (in the user's language)

```
## 결과 요약   status · passed/failed/errors/skipped · duration · runId(short) · report.html path
## 실패        step id + name/action · expected vs actual · what the screenshot shows · likely cause
## 콘솔·네트워크 오류   deduplicated, most relevant first
## 성능         metrics outside limits (or "이상 없음")
## 시각 비교 · 다운로드   diff ratio vs threshold · download checks
## 다음 단계     concrete fixes (script edit / bug report / rerun) — ask before editing files
```

Omit empty sections. When a fix to the script is agreed, edit the YAML, `validate_script`, and re-run to confirm.
