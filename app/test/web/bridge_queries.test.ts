import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
// Web modules use the separate Next.js bundler tsconfig; load them at runtime here.

test('phone console discovers bound CLI sessions in CODEX_HOME without a desktop index', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wechat-web-'));
  const saved = { CODEX_HOME: process.env.CODEX_HOME, CODEXBRIDGE_WEB_STATE_DIR: process.env.CODEXBRIDGE_WEB_STATE_DIR };
  try {
    const state = path.join(root, 'state'); const home = path.join(root, 'cli-home');
    fs.mkdirSync(path.join(state, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
    process.env.CODEX_HOME = home;
    process.env.CODEXBRIDGE_WEB_STATE_DIR = state;
    const write = (name: string, value: unknown) => fs.writeFileSync(path.join(state, 'runtime', name), JSON.stringify(value));
    write('provider_profiles.json', [{ id: 'native', providerKind: 'openai-native', displayName: 'Native' }]);
    write('bridge_sessions.json', [{ id: 'session-1', providerProfileId: 'native', codexThreadId: 'thread-1', cwd: root, title: 'Test conversation', updatedAt: Date.now() }]);
    fs.writeFileSync(path.join(home, 'sessions', 'rollout-thread-1.jsonl'), [
      { type: 'session_meta', payload: { id: 'thread-1', cwd: root } },
      { type: 'response_item', timestamp: '2026-10-24T00:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
    ].map(r => JSON.stringify(r)).join('\n'));
    const { listWebCodexThreads, listWebCodexThreadMessages } = await import(String('../../apps/web/lib/server/queries.js'));
    const threads = await listWebCodexThreads();
    assert.equal(threads.length, 1);
    assert.equal(threads[0].threadId, 'thread-1');
    const history = await listWebCodexThreadMessages('thread-1');
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].text, 'hello');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    // This is the exact temporary directory returned by mkdtempSync above.
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('codex-wechat-web-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
