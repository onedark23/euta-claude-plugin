// Tests for plugins/euta/scripts/hook-forward.mjs (the hook → desktop app forwarder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../plugins/euta/scripts/hook-forward.mjs', import.meta.url));
const INPUT = JSON.stringify({
  session_id: 'abc123',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/tmp/proj',
  hook_event_name: 'PreToolUse',
  tool_name: 'mcp__plugin_euta_euta__run_script',
  tool_input: { path: '/tmp/한글 경로/login.yaml' },
  tool_use_id: 'toolu_01',
});

/** Runs the forwarder like Claude Code does (stdin JSON, inherited env + overrides). */
function runHook(env, input = INPUT, { closeStdin = true } = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.EUTA_APP_URL;
  delete baseEnv.EUTA_APP_TOKEN;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [SCRIPT], { env: { ...baseEnv, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr, elapsed: Date.now() - started }));
    child.stdin.on('error', () => {});
    child.stdin.write(input);
    if (closeStdin) child.stdin.end();
  });
}

/** Local receiver recording every request. `respond: false` accepts but never answers. */
async function receiver({ respond = true } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      if (respond) res.writeHead(204).end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    port,
    requests,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

async function freePort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function assertSilent(r) {
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
}

test('no EUTA_APP_URL: exits 0 quickly with no output', async () => {
  const r = await runHook({});
  assertSilent(r);
  assert.ok(r.elapsed < 800, `took ${r.elapsed}ms`);
});

test('no EUTA_APP_URL: does not wait for stdin', async () => {
  const r = await runHook({}, INPUT, { closeStdin: false });
  assertSilent(r);
  assert.ok(r.elapsed < 800, `took ${r.elapsed}ms`);
});

test('loopback receiver: POSTs stdin unchanged with bearer token', async () => {
  const rx = await receiver();
  try {
    const r = await runHook({ EUTA_APP_URL: `http://127.0.0.1:${rx.port}`, EUTA_APP_TOKEN: 'tok-123' });
    assertSilent(r);
    assert.equal(rx.requests.length, 1);
    const [req] = rx.requests;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/hooks/claude');
    assert.equal(req.headers.authorization, 'Bearer tok-123');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.ok(req.body.equals(Buffer.from(INPUT, 'utf8')), 'body must equal stdin byte for byte');
  } finally {
    await rx.close();
  }
});

test('trailing slash and localhost are accepted', async () => {
  const rx = await receiver();
  try {
    const r = await runHook({ EUTA_APP_URL: `http://localhost:${rx.port}/`, EUTA_APP_TOKEN: 't' });
    assertSilent(r);
    assert.equal(rx.requests.length, 1);
    assert.equal(rx.requests[0].url, '/hooks/claude');
  } finally {
    await rx.close();
  }
});

test('unreachable port: exits 0 within the deadline, no output', async () => {
  const port = await freePort();
  const r = await runHook({ EUTA_APP_URL: `http://127.0.0.1:${port}`, EUTA_APP_TOKEN: 't' });
  assertSilent(r);
  assert.ok(r.elapsed < 1500, `took ${r.elapsed}ms`);
});

test('app accepts but never responds: gives up at the deadline, no output', async () => {
  const rx = await receiver({ respond: false });
  try {
    const r = await runHook({ EUTA_APP_URL: `http://127.0.0.1:${rx.port}`, EUTA_APP_TOKEN: 't' });
    assertSilent(r);
    assert.ok(r.elapsed >= 900 && r.elapsed < 1500, `took ${r.elapsed}ms`);
  } finally {
    await rx.close();
  }
});

test('stdin never closes: gives up at the deadline, sends nothing', async () => {
  const rx = await receiver();
  try {
    const r = await runHook({ EUTA_APP_URL: `http://127.0.0.1:${rx.port}` }, INPUT, { closeStdin: false });
    assertSilent(r);
    assert.ok(r.elapsed < 1500, `took ${r.elapsed}ms`);
    assert.equal(rx.requests.length, 0);
  } finally {
    await rx.close();
  }
});

test('non-loopback or non-http URLs are never contacted', async () => {
  const rx = await receiver();
  try {
    for (const url of [
      `http://0.0.0.0:${rx.port}`, // reaches the local receiver on most OSes, but is not loopback
      `http://example.com:${rx.port}`,
      `http://127.0.0.1.nip.io:${rx.port}`,
      `ftp://127.0.0.1:${rx.port}`,
      `file:///etc/passwd`,
      'not a url',
    ]) {
      const r = await runHook({ EUTA_APP_URL: url, EUTA_APP_TOKEN: 'secret-token' });
      assertSilent(r);
      assert.ok(r.elapsed < 800, `${url} took ${r.elapsed}ms`);
    }
    assert.equal(rx.requests.length, 0);
  } finally {
    await rx.close();
  }
});
