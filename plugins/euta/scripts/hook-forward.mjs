#!/usr/bin/env node
// Forwards one Claude Code hook event to the euta desktop app:
//   POST ${EUTA_APP_URL}/hooks/claude   Authorization: Bearer ${EUTA_APP_TOKEN}
//   body = the hook input JSON from stdin, byte for byte.
// Contract: silent and non-blocking. Never writes stdout/stderr, always exits 0, gives up after
// DEADLINE_MS. Does nothing unless EUTA_APP_URL is set to an http(s) loopback URL.
import http from 'node:http';
import https from 'node:https';

const DEADLINE_MS = 1000; // SessionEnd hooks share a 1.5 s budget that plugin timeouts can't raise
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const quit = () => process.exit(0);

function endpoint(raw) {
  if (!raw) return undefined;
  let url;
  try {
    url = new URL(`${raw.trim().replace(/\/+$/, '')}/hooks/claude`);
  } catch {
    return undefined;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK.has(url.hostname)) return undefined;
  return url;
}

const url = endpoint(process.env.EUTA_APP_URL);
if (!url) quit();

process.on('uncaughtException', quit);
setTimeout(quit, DEADLINE_MS).unref();

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('error', quit);
process.stdin.on('end', () => {
  const body = Buffer.concat(chunks);
  const headers = { 'Content-Type': 'application/json', 'Content-Length': body.length };
  const token = process.env.EUTA_APP_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = (url.protocol === 'https:' ? https : http).request(url, { method: 'POST', headers, timeout: DEADLINE_MS }, (res) => {
    res.resume();
    res.on('end', quit);
    res.on('error', quit);
  });
  req.on('timeout', quit);
  req.on('error', quit);
  req.end(body);
});
