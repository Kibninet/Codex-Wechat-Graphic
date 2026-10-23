import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleManagedWindowsRestart } from '../../src/runtime/managed_restart.js';

test('managed Windows restart delays child exit until after the response is delivered', () => {
  let callback: (() => void) | null = null;
  let exitCode: number | null = null;
  assert.equal(scheduleManagedWindowsRestart({
    platform: 'win32', env: { CODEXBRIDGE_SERVICE_MANAGED: '1' },
    exit: (code) => { exitCode = code; },
    schedule: (work, delay) => { assert.ok(delay >= 200); callback = work; },
  }), true);
  assert.equal(exitCode, null);
  callback!();
  assert.equal(exitCode, 0);
});

test('Windows restart refuses unmanaged execution and leaves other platforms alone', () => {
  assert.throws(() => scheduleManagedWindowsRestart({ platform: 'win32', env: {} }), /background service/);
  assert.equal(scheduleManagedWindowsRestart({ platform: 'linux', env: {} }), false);
});
