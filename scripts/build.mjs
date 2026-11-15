import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';

// Native helpers. Recompiled only when their source changes.
const NATIVE = [
  { src: 'native/selection-watcher.c', bin: 'bin/selection-watcher', flags: ['-framework', 'ApplicationServices'] },
  { src: 'native/clipboard-grab.m', bin: 'bin/clipboard-grab', flags: ['-fobjc-arc', '-framework', 'AppKit', '-framework', 'ApplicationServices'] },
];
for (const { src, bin, flags } of NATIVE) {
  if (existsSync(bin) && statSync(src).mtimeMs <= statSync(bin).mtimeMs) continue;
  mkdirSync('bin', { recursive: true });
  try {
    execFileSync('clang', ['-O2', '-Wall', ...flags, src, '-o', bin], { stdio: 'inherit' });
    console.log(`compiled ${bin}`);
  } catch {
    console.warn(`⚠ could not compile ${bin} (needs Xcode Command Line Tools); the hotkey won't be able to read selections`);
  }
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/renderer', { recursive: true });

const node = { bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], sourcemap: true };

await Promise.all([
  build({ ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' }),
  build({ ...node, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js' }),
  build({ ...node, entryPoints: ['src/main/test-lookup.ts'], outfile: 'dist/test-lookup.js' }),
  build({
    bundle: true,
    platform: 'browser',
    target: 'chrome156',
    format: 'iife',
    sourcemap: true,
    entryPoints: ['src/renderer/app.ts'],
    outfile: 'dist/renderer/app.js',
  }),
]);

cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
console.log('built → dist/');
