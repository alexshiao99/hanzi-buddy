import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';

// Native selection watcher (used by hidden mode). Recompiled only when the C source changes.
const NATIVE_SRC = 'native/selection-watcher.c';
const NATIVE_BIN = 'bin/selection-watcher';
if (!existsSync(NATIVE_BIN) || statSync(NATIVE_SRC).mtimeMs > statSync(NATIVE_BIN).mtimeMs) {
  mkdirSync('bin', { recursive: true });
  try {
    execFileSync('clang', ['-O2', '-Wall', '-framework', 'ApplicationServices', NATIVE_SRC, '-o', NATIVE_BIN], {
      stdio: 'inherit',
    });
    console.log(`compiled ${NATIVE_BIN}`);
  } catch {
    console.warn('⚠ could not compile the selection watcher (needs Xcode Command Line Tools); hidden mode will fall back to ⌘C');
  }
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/renderer', { recursive: true });

const node = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron'], sourcemap: true };

await Promise.all([
  build({ ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' }),
  build({ ...node, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js' }),
  build({ ...node, entryPoints: ['src/main/test-lookup.ts'], outfile: 'dist/test-lookup.js' }),
  build({
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    sourcemap: true,
    entryPoints: ['src/renderer/app.ts'],
    outfile: 'dist/renderer/app.js',
  }),
]);

cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
console.log('built → dist/');
