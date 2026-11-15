// Bundles test/*.test.ts with esbuild, then runs them with Node's built-in test runner.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';

const OUT = 'dist-test';
rmSync(OUT, { recursive: true, force: true });

const entryPoints = readdirSync('test')
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => `test/${f}`);

await build({ entryPoints, outdir: OUT, bundle: true, platform: 'node', target: 'node24', format: 'cjs', logLevel: 'error' });

const files = readdirSync(OUT).map((f) => `${OUT}/${f}`);
const { status } = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(status ?? 1);
