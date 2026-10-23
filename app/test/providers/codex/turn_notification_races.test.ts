import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexAppClient } from '../../../src/providers/codex/app_client.js';

function makeClient(onSleep?: (client: CodexAppClient, now: number) => void) {
  let now = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex', turnPollNow: () => now,
    turnPollSleep: async (ms) => { now += ms; onSleep?.(client, now); },
  });
  client.transportKind = 'stdio';
  client.request = async () => ({ turn: { id: 'turn-1' } });
  return { client, elapsed: () => now };
}

function complete(client: CodexAppClient, status = 'completed', turnId = 'turn-1', error: any = null) {
  client.emit('notification', { method: 'turn/completed',
    params: { threadId: 'thread-1', turn: { id: turnId, status, error } } });
}

function answer(client: CodexAppClient, threadId = 'thread-1', text = 'Here.') {
  client.emit('notification', { method: 'item/agentMessage/delta', params: {
    threadId, turnId: 'turn-1', phase: 'final_answer', itemId: 'answer-1', delta: text,
  } });
}

for (const stage of ['before acknowledgement', 'during start callback']) {
  test(`stdio preserves a fast final answer ${stage} exactly once`, async () => {
    const { client, elapsed } = makeClient();
    const progress: string[] = [];
    const emit = () => { answer(client); complete(client); };
    if (stage === 'before acknowledgement') {
      client.request = async () => { emit(); return { turn: { id: 'turn-1' } }; };
    }
    const result = await client.startTurn({ threadId: 'thread-1', inputText: 'hello',
      onTurnStarted: stage === 'during start callback' ? async () => { emit(); } : null,
      onProgress: (p) => { progress.push(p.delta); },
    });
    assert.equal(result.outputText, 'Here.');
    assert.equal(result.outputState, 'complete');
    assert.deepEqual(progress, ['Here.']);
    assert.ok(elapsed() <= 1000);
    assert.equal(client.listenerCount('notification'), 0);
    assert.equal(client.listenerCount('approval_request'), 0);
  });
}

test('stdio releases an interrupted turn without waiting for the 15 minute deadline', async () => {
  const { client, elapsed } = makeClient();
  const result = await client.startTurn({ threadId: 'thread-1', inputText: 'hello',
    onTurnStarted: () => { complete(client, 'interrupted'); },
  });
  assert.equal(result.outputState, 'interrupted');
  assert.equal(result.status, 'interrupted');
  assert.ok(elapsed() < 1000);
});

test('stdio reports a failed terminal notification without waiting for text', async () => {
  const { client, elapsed } = makeClient();
  const result = await client.startTurn({ threadId: 'thread-1', inputText: 'hello',
    onTurnStarted: () => { complete(client, 'failed', 'turn-1', { message: 'Provider unavailable' }); },
  });
  assert.equal(result.outputState, 'provider_error');
  assert.equal(result.errorMessage, 'Provider unavailable');
  assert.ok(elapsed() < 1000);
});

test('stdio finishes an empty completed turn after a brief settlement', async () => {
  const { client, elapsed } = makeClient();
  const result = await client.startTurn({ threadId: 'thread-1', inputText: 'hello',
    onTurnStarted: () => { complete(client); },
  });
  assert.equal(result.outputState, 'missing');
  assert.ok(elapsed() >= 500 && elapsed() <= 1000);
});

test('stdio ignores another turn completion and another thread answer', async () => {
  let sentFinal = false;
  const { client, elapsed } = makeClient((c, now) => {
    if (!sentFinal && now >= 1500) {
      sentFinal = true;
      answer(c);
      complete(c);
    }
  });
  const result = await client.startTurn({ threadId: 'thread-1', inputText: 'hello',
    onTurnStarted: () => {
      answer(client, 'thread-other', 'Wrong answer');
      complete(client, 'completed', 'previous-turn');
    },
  });
  assert.equal(result.outputText, 'Here.');
  assert.equal(result.outputState, 'complete');
  assert.ok(elapsed() >= 1500 && elapsed() < 3000);
});

test('start failures and callback failures remove the early notification listener', async () => {
  for (const stage of ['request', 'callback']) {
    const { client } = makeClient();
    if (stage === 'request') client.request = async () => { throw new Error('start failed'); };
    await assert.rejects(client.startTurn({ threadId: 'thread-1', inputText: 'hello',
      onTurnStarted: () => { throw new Error('callback failed'); },
    }), /failed/);
    assert.equal(client.listenerCount('notification'), 0);
    assert.equal(client.listenerCount('approval_request'), 0);
  }
});
