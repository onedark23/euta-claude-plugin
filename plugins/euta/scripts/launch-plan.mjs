// Pure launch-plan resolution for mcp-launch.mjs (kept separate so tests can import it).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const MAIN_REL = join('packages', 'mcp-server', 'dist', 'main.js');

/** Empty, whitespace, or an unsubstituted placeholder such as "${user_config.x}" → undefined. */
export function clean(value) {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (v === '' || v.startsWith('${')) return undefined;
  return v;
}

/** Parses "--name value" pairs; unknown flags are ignored. */
export function parseLaunchArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(engine-dir|runs-dir|secrets)$/.exec(argv[i]);
    if (m && i + 1 < argv.length) out[m[1]] = argv[++i];
  }
  return out;
}

/** Pure resolution of the launch plan (exported for tests). */
export function resolvePlan(argv, env, pluginRoot, home = homedir()) {
  const args = parseLaunchArgs(argv);
  const candidates = [
    clean(args['engine-dir']),
    clean(env.EUTA_ENGINE_DIR),
    resolve(pluginRoot, '..', '..', '..', 'euta-engine'),
  ].filter(Boolean);
  const engineDir = candidates.map((d) => resolve(d)).find((d) => existsSync(join(d, MAIN_REL)));
  return {
    engineDir,
    tried: candidates.map((d) => resolve(d)),
    runsDir: resolve(clean(env.EUTA_RUNS_DIR) ?? clean(args['runs-dir']) ?? join(home, '.euta', 'runs')),
    secretsFile: clean(env.EUTA_SECRETS_FILE) ?? clean(args.secrets),
  };
}
