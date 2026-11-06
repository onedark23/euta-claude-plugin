#!/usr/bin/env node
// Launches the euta MCP server (euta-engine/packages/mcp-server) in this process.
// stdout is the MCP JSON-RPC channel: this script never writes to it; errors go to stderr.
//
// Resolution (first non-empty wins; an unexpanded "${...}" counts as empty):
//   engine dir : --engine-dir (plugin userConfig) > EUTA_ENGINE_DIR > sibling ../euta-engine of this repo
//   runs dir   : EUTA_RUNS_DIR > --runs-dir (userConfig) > ~/.euta/runs
//   secrets    : EUTA_SECRETS_FILE > --secrets (userConfig) > none
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAIN_REL, resolvePlan } from './launch-plan.mjs';

async function launch() {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const plan = resolvePlan(process.argv.slice(2), process.env, pluginRoot);
  if (!plan.engineDir) {
    process.stderr.write(
      `[euta-mcp-launch] euta engine not found (looked for ${MAIN_REL} in: ${plan.tried.join(', ')}).\n` +
        `[euta-mcp-launch] Build euta-engine (pnpm install && pnpm -r build) and set its path with ` +
        `"/plugin configure euta@euta-tools" (engine_dir) or the EUTA_ENGINE_DIR environment variable.\n`,
    );
    process.exit(1);
  }
  // The engine treats "" differently from unset (e.g. EUTA_STEP_IMAGE="" throws): drop empty EUTA_* vars.
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('EUTA_') && (v ?? '').trim() === '') delete process.env[k];
  const engineArgs = ['--runs-dir', plan.runsDir];
  if (plan.secretsFile) engineArgs.push('--secrets', resolve(plan.secretsFile));
  const { main } = await import(pathToFileURL(join(plan.engineDir, MAIN_REL)).href);
  await main(engineArgs);
}

launch().catch((err) => {
  process.stderr.write(`[euta-mcp-launch] ${err?.stack ?? err}\n`);
  process.exit(1);
});
