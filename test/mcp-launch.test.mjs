// Verifies that plugins/euta/.mcp.json starts the euta MCP server the way Claude Code would:
// the configured command/args/env are expanded (${CLAUDE_PLUGIN_ROOT}, ${user_config.*}, ${VAR:-default}),
// spawned over stdio, and answer MCP initialize + tools/list.
// Requires a built euta-engine (EUTA_ENGINE_DIR, or the sibling ../euta-engine folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIN_REL, clean, resolvePlan } from '../plugins/euta/scripts/launch-plan.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('../plugins/euta', import.meta.url));
const ENGINE_DIR = resolve(process.env.EUTA_ENGINE_DIR || join(PLUGIN_ROOT, '..', '..', '..', 'euta-engine'));
const HAS_ENGINE = existsSync(join(ENGINE_DIR, MAIN_REL));
const EXPECTED_TOOLS = [
  'validate_script', 'run_script', 'list_runs', 'get_run', 'get_screenshot', 'get_artifact', 'get_schema',
  'session_open', 'session_step', 'session_snapshot', 'session_screenshot', 'session_export', 'session_close',
  'get_page_map', 'check_script_targets',
];

/**
 * Expands a .mcp.json string the way Claude Code documents it: plugin path variables,
 * ${user_config.KEY} (left as-is when `userConfig` lacks the key, to simulate an unknown substitution),
 * then ${VAR} / ${VAR:-default} from the environment.
 */
function expand(value, { userConfig, env }) {
  return value
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', PLUGIN_ROOT)
    .replace(/\$\{user_config\.([A-Za-z0-9_]+)\}/g, (m, k) => (k in userConfig ? userConfig[k] : m))
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (m, k, def) => env[k] ?? def ?? m);
}

function serverConfig(ctx) {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.mcp.json'), 'utf8')).mcpServers.euta;
  return {
    command: expand(cfg.command, ctx),
    args: cfg.args.map((a) => expand(a, ctx)),
    env: Object.fromEntries(Object.entries(cfg.env ?? {}).map(([k, v]) => [k, expand(v, ctx)])),
  };
}

/** Minimal newline-delimited JSON-RPC client over the child's stdio. */
function startServer({ command, args, env }) {
  const child = spawn(command === 'node' ? process.execPath : command, args, {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  let stderr = '';
  const pending = new Map();
  const nonJson = [];
  child.stderr.on('data', (d) => (stderr += d));
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        nonJson.push(line);
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let nextId = 1;
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  return {
    child,
    nonJson,
    stderr: () => stderr,
    request(method, params = {}) {
      const id = nextId++;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`${method} timed out; stderr:\n${stderr}`)), 30_000);
        pending.set(id, (m) => { clearTimeout(t); res(m); });
      });
    },
    notify(method, params = {}) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    },
    async stop() {
      child.stdin.end();
      const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      const r = await exited;
      clearTimeout(killer);
      return r;
    },
  };
}

async function handshakeAndListTools(srv) {
  const init = await srv.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'euta-plugin-test', version: '0.0.0' },
  });
  assert.ok(init.result, `initialize failed: ${JSON.stringify(init.error)}\n${srv.stderr()}`);
  srv.notify('notifications/initialized');
  const list = await srv.request('tools/list');
  return { init, tools: list.result.tools.map((t) => t.name) };
}

test('launch plan: precedence and placeholder handling', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'euta-plan-'));
  try {
    const fakePluginRoot = join(tmp, 'repo', 'plugins', 'euta');
    assert.equal(clean('${user_config.engine_dir}'), undefined);
    assert.equal(clean('  '), undefined);
    // Nothing configured and no sibling engine → not found, default runs dir under home.
    const none = resolvePlan(['--engine-dir', '', '--runs-dir', '${user_config.runs_dir}', '--secrets', ''], {}, fakePluginRoot, '/home/u');
    assert.equal(none.engineDir, undefined);
    assert.equal(none.runsDir, resolve('/home/u/.euta/runs'));
    assert.equal(none.secretsFile, undefined);
    // userConfig values are used when the environment has none.
    const cfg = resolvePlan(['--engine-dir', ENGINE_DIR, '--runs-dir', '/r/cfg', '--secrets', '/s/cfg.json'], {}, fakePluginRoot, '/home/u');
    if (HAS_ENGINE) assert.equal(cfg.engineDir, ENGINE_DIR);
    assert.equal(cfg.runsDir, resolve('/r/cfg'));
    assert.equal(cfg.secretsFile, '/s/cfg.json');
    // Environment (e.g. set by the desktop app) wins for runs/secrets; EUTA_ENGINE_DIR is a fallback.
    const env = resolvePlan(['--engine-dir', '', '--runs-dir', '/r/cfg', '--secrets', '/s/cfg.json'],
      { EUTA_RUNS_DIR: '/r/env', EUTA_SECRETS_FILE: '/s/env.json', EUTA_ENGINE_DIR: ENGINE_DIR }, fakePluginRoot, '/home/u');
    if (HAS_ENGINE) assert.equal(env.engineDir, ENGINE_DIR);
    assert.equal(env.runsDir, resolve('/r/env'));
    assert.equal(env.secretsFile, '/s/env.json');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('.mcp.json with userConfig set: server starts and lists 15 tools', { skip: !HAS_ENGINE && 'euta-engine not built' }, async () => {
  const runs = mkdtempSync(join(tmpdir(), 'euta-runs-'));
  const env = { ...process.env };
  for (const k of ['EUTA_RUNS_DIR', 'EUTA_SECRETS_FILE', 'EUTA_ENGINE_DIR', 'EUTA_APP_EVENTS_URL', 'EUTA_APP_EVENTS_TOKEN']) delete env[k];
  const cfg = serverConfig({ userConfig: { engine_dir: ENGINE_DIR, runs_dir: runs, secrets_file: '' }, env });
  assert.equal(cfg.env.EUTA_APP_EVENTS_URL, '', 'unset app URL expands to the empty default');
  const srv = startServer({ ...cfg, env: { ...cfg.env, EUTA_RUNS_DIR: '' } });
  try {
    const { init, tools } = await handshakeAndListTools(srv);
    assert.equal(init.result.serverInfo.name, 'euta');
    assert.deepEqual([...tools].sort(), [...EXPECTED_TOOLS].sort());
    const runsList = await srv.request('tools/call', { name: 'list_runs', arguments: {} });
    assert.ok(!runsList.result.isError, JSON.stringify(runsList));
    assert.ok(existsSync(join(runs, 'index.sqlite')), 'runs_dir from userConfig is used');
    assert.deepEqual(srv.nonJson, [], 'stdout carries JSON-RPC only');
  } finally {
    const { code } = await srv.stop();
    assert.equal(code, 0);
    rmSync(runs, { recursive: true, force: true });
  }
});

test('.mcp.json with userConfig unset: sibling engine is found, env runs dir wins', { skip: !HAS_ENGINE && 'euta-engine not built' }, async () => {
  const runs = mkdtempSync(join(tmpdir(), 'euta-runs-'));
  const env = { ...process.env, EUTA_RUNS_DIR: runs, EUTA_APP_EVENTS_URL: 'http://127.0.0.1:9/events', EUTA_APP_EVENTS_TOKEN: 'tok' };
  delete env.EUTA_ENGINE_DIR;
  const cfg = serverConfig({ userConfig: {}, env });
  assert.equal(cfg.args[2], '${user_config.engine_dir}', 'placeholder left unsubstituted');
  assert.equal(cfg.env.EUTA_APP_EVENTS_URL, 'http://127.0.0.1:9/events', 'app events URL passes through');
  assert.equal(cfg.env.EUTA_APP_EVENTS_TOKEN, 'tok');
  const srv = startServer({ ...cfg, env: { ...cfg.env, EUTA_RUNS_DIR: runs, EUTA_ENGINE_DIR: '' } });
  try {
    const { tools } = await handshakeAndListTools(srv);
    assert.equal(tools.length, EXPECTED_TOOLS.length);
    await srv.request('tools/call', { name: 'list_runs', arguments: {} });
    assert.ok(existsSync(join(runs, 'index.sqlite')), 'EUTA_RUNS_DIR from the environment is used');
    assert.deepEqual(srv.nonJson, []);
  } finally {
    await srv.stop();
    rmSync(runs, { recursive: true, force: true });
  }
});

test('engine missing: exits 1 with a hint on stderr and nothing on stdout', async () => {
  // Copy the launcher into a temp plugin layout that has no sibling euta-engine.
  const tmp = mkdtempSync(join(tmpdir(), 'euta-noengine-'));
  const scripts = join(tmp, 'repo', 'plugins', 'euta', 'scripts');
  mkdirSync(scripts, { recursive: true });
  for (const f of ['mcp-launch.mjs', 'launch-plan.mjs']) copyFileSync(join(PLUGIN_ROOT, 'scripts', f), join(scripts, f));
  const srv = startServer({
    command: 'node',
    args: [join(scripts, 'mcp-launch.mjs'), '--engine-dir', '${user_config.engine_dir}'],
    env: { EUTA_ENGINE_DIR: join(tmp, 'nope') },
  });
  try {
    const { code } = await srv.stop();
    assert.equal(code, 1);
    assert.match(srv.stderr(), /euta engine not found/);
    assert.match(srv.stderr(), /plugin configure euta@euta-tools/);
    assert.deepEqual(srv.nonJson, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
