import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { SelectionWatcher } from '../src/main/selection';

function fakeHelper(script: string, mode = 0o755): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hanzi-buddy-helper-')), 'helper');
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, mode);
  return file;
}

/** macOS can take a while to launch a just-created script, so wait for results instead of timing them. */
async function waitFor(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for condition');
    await sleep(20);
  }
}

describe('SelectionWatcher', () => {
  it('reports highlighted text from the helper', async () => {
    const watcher = new SelectionWatcher(fakeHelper(`echo '"你好"'; sleep 10`), () => {});
    watcher.start();
    await waitFor(() => watcher.current === '你好');
    watcher.stop();
    assert.equal(watcher.current, '');
  });

  it('survives a helper that cannot be started', async () => {
    const watcher = new SelectionWatcher(fakeHelper('', 0o644), () => {});
    watcher.start(); // EACCES arrives as an 'error' event, which would crash the app if unhandled
    await sleep(100);
    assert.equal(watcher.current, '');
    watcher.stop();
  });

  it('ignores the exit of a helper it already replaced', async () => {
    const helper = fakeHelper(`trap 'sleep 0.3; exit 0' TERM; echo '"你好"'; sleep 10 & wait`);
    const watcher = new SelectionWatcher(helper, () => {});
    watcher.start();
    await waitFor(() => watcher.current === '你好');
    watcher.stop();
    watcher.start(); // the first helper is still shutting down
    await waitFor(() => watcher.current === '你好');
    await sleep(600); // long enough for the first helper's exit to arrive
    assert.equal(watcher.current, '你好');
    watcher.stop();
  });

  it('restarts a helper that crashes', async () => {
    let changes = 0;
    const watcher = new SelectionWatcher(fakeHelper(`echo '"你好"'; exit 1`), () => changes++);
    watcher.start();
    await waitFor(() => changes >= 3); // appears, clears on exit, appears again after the restart
    watcher.stop();
  });
});
