import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createBridgeController } from '../../apps/web/server/bridge-control.js';
import { isSameOriginRequest } from '../../apps/web/lib/request-origin.js';

test('same-origin checks accept real LAN hosts despite Next localhost normalization', () => {
  const request = (origin: string, host = '192.168.1.20:58888') => new Request('http://localhost:58888/api/bridge/control', { headers: { origin, host } });
  assert.equal(isSameOriginRequest(request('http://192.168.1.20:58888')), true);
  assert.equal(isSameOriginRequest(request('http://127.0.0.1:58888', '127.0.0.1:58888')), true);
  assert.equal(isSameOriginRequest(request('https://192.168.1.20:58888')), false);
  assert.equal(isSameOriginRequest(request('http://other.example')), false);
  assert.equal(isSameOriginRequest(request('null')), false);
  assert.equal(isSameOriginRequest(new Request('http://localhost:58888/api/bridge/control')), false);
});

const scriptPath = path.resolve('test-fixture-manager.ps1');
test('service control executes only the configured script with a fixed action', async () => {
  const calls: unknown[] = [];
  const control = createBridgeController({ platform: 'win32', scriptPath, exists: () => true,
    run: async (file, args) => { calls.push({ file, args }); return { stdout: 'Bridge started through Windows Task Scheduler (PID 123).', stderr: '' }; },
  });
  assert.deepEqual(await control('start'), { configured: true, running: true, message: '电脑桥接正在运行' });
  assert.deepEqual(calls, [{ file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', 'Start'] }]);
  await assert.rejects(control('restart; whoami' as any), /不支持/);
  assert.equal(calls.length, 1);
});

test('unconfigured, relative and unsupported hosts cannot execute a process', async () => {
  for (const options of [{ platform: 'linux', scriptPath }, { platform: 'win32', scriptPath: 'relative.ps1' }, { platform: 'win32', scriptPath: '' }]) {
    const control = createBridgeController({ ...options, exists: () => true, run: async () => { throw new Error('Must never run'); } });
    assert.equal((await control('start')).configured, false);
  }
});

test('service control blocks overlapping actions and releases its lock after failure', async () => {
  let release: (result: { stdout: string; stderr: string }) => void;
  const control = createBridgeController({ platform: 'win32', scriptPath, exists: () => true,
    run: async () => new Promise(resolve => { release = resolve; }),
  });
  const first = control('status');
  await assert.rejects(control('stop'), /上一次操作/);
  release!({ stdout: 'Bridge running (PID 1).', stderr: '' });
  assert.equal((await first).running, true);
  const second = control('stop');
  release!({ stdout: 'Bridge stopped.', stderr: '' });
  assert.equal((await second).running, false);

  let failed = true;
  const retryable = createBridgeController({ platform: 'win32', scriptPath, exists: () => true,
    run: async () => { if (failed) { failed = false; throw new Error('Unavailable'); } return { stdout: 'Bridge stopped.', stderr: '' }; },
  });
  await assert.rejects(retryable('status'), /Unavailable/);
  assert.equal((await retryable('status')).running, false);
});
