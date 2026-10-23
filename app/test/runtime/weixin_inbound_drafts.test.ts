import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinBridgeRuntime } from '../../src/runtime/weixin_bridge_runtime.js';
import { WeixinConversationRouter } from '../../src/runtime/weixin_conversation_router.js';

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-draft-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'sample.bak');
  fs.writeFileSync(filePath, 'test backup');
  const seen: any[] = [], sent: any[] = [];
  let busy = false;
  const create = (handler?: (event: any) => Promise<any>, steer?: (event: any) => Promise<any>) => new WeixinBridgeRuntime({
    inboundDraftsPath: path.join(root, 'drafts.json'),
    conversationRouter: new WeixinConversationRouter(path.join(root, 'chats.json')),
    isConversationBusy: () => busy,
    typingKeepaliveMs: 0,
    platformPlugin: {
      async start() {}, async stop() {}, async pollOnce() { return { events: [] }; },
      async sendText(message: any) { sent.push(message); return { success: true, deliveredCount: 1, deliveredText: message.content, failedIndex: null, failedText: '', error: '' }; },
    },
    bridgeCoordinator: { ...(steer ? { steerInboundEvent: steer } : {}), async handleInboundEvent(event: any) {
      seen.push(event);
      if (handler) return handler(event);
      return { type: 'message', messages: [{ text: 'done' }] };
    } },
  });
  const event = (text: string, attachments: any[] = [], id?: string) => ({
    platform: 'weixin', externalScopeId: 'owner', text, attachments,
    metadata: { weixin: { messageId: id, attachmentErrors: [] } },
  });
  const file = { kind: 'file', fileName: 'sample.bak', localPath: filePath };
  return { create, seen, sent, event, file, filePath, busy: (value: boolean) => { busy = value; } };
}

test('text and multiple files in either order wait for /send and become exactly one turn', async (t) => {
  const f = fixture(t), runtime = f.create();
  await runtime.handleInboundEvent(f.event('first line'));
  await runtime.handleInboundEvent(f.event('', [f.file]));
  await runtime.handleInboundEvent(f.event('second line', [f.file]));
  await runtime.waitForIdle();
  assert.equal(f.seen.length, 0);
  await runtime.handleInboundEvent(f.event('/pending'));
  assert.match(f.sent.at(-1).content, /2 个附件/);
  await runtime.handleInboundEvent(f.event('/send final line'));
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0].text, 'first line\n\nsecond line\n\nfinal line');
  assert.equal(f.seen[0].attachments.length, 2);
  await runtime.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen.length, 1);
  assert.match(f.sent.at(-1).content, /草稿为空/);
});

test('file-only /send starts immediately; drafts survive restart and /discard consumes no model turn', async (t) => {
  const f = fixture(t);
  await f.create().handleInboundEvent(f.event('', [f.file]));
  const restarted = f.create();
  await restarted.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0].attachments[0].localPath, f.filePath);
  await restarted.handleInboundEvent(f.event('discard this'));
  await restarted.handleInboundEvent(f.event('/discard'));
  await f.create().handleInboundEvent(f.event('/send'));
  assert.equal(f.seen.length, 1);
});

test('named chats isolate drafts across switches and submit only the targeted chat', async (t) => {
  const f = fixture(t), runtime = f.create();
  await runtime.handleInboundEvent(f.event('main draft'));
  await runtime.handleInboundEvent(f.event('/chat new second'));
  await runtime.handleInboundEvent(f.event('second draft'));
  await runtime.handleInboundEvent(f.event('@主会话 /send'));
  assert.equal(f.seen[0].text, 'main draft');
  await runtime.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen[1].text, 'second draft');
  assert.notEqual(f.seen[0].externalScopeId, f.seen[1].externalScopeId);
});

test('a busy conversation retains /send content until the user submits again; /stop is immediate', async (t) => {
  const f = fixture(t), runtime = f.create();
  f.busy(true);
  await runtime.handleInboundEvent(f.event('next request'));
  await runtime.handleInboundEvent(f.event('/send extra'));
  assert.equal(f.seen.length, 0);
  assert.match(f.sent.at(-1).content, /保留.*草稿|草稿已保留/);
  await runtime.handleInboundEvent(f.event('/stop'));
  assert.equal(f.seen[0].text, '/stop');
  f.busy(false);
  await runtime.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen[1].text, 'next request\n\nextra');
});

test('failed and missing attachments never start a model turn, even when text is present', async (t) => {
  const f = fixture(t), runtime = f.create();
  const bad = f.event('analyze this');
  bad.metadata.weixin.attachmentErrors = ['weixin_media:timeout'] as any;
  await runtime.handleInboundEvent(bad);
  await runtime.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen.length, 0);
  await runtime.handleInboundEvent(f.event('', [f.file]));
  await runtime.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen.length, 1);
  await runtime.handleInboundEvent(f.event('another', [f.file]));
  fs.unlinkSync(f.filePath);
  await runtime.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen.length, 1);
  assert.match(f.sent.at(-1).content, /已不在电脑上/);
});

test('redelivered messages do not duplicate draft text or file references', async (t) => {
  const f = fixture(t), runtime = f.create();
  const inbound = f.event('one', [f.file], 'stable-message-id');
  await runtime.handleInboundEvent(inbound);
  await runtime.handleInboundEvent(inbound);
  await runtime.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen[0].text, 'one');
  assert.equal(f.seen[0].attachments.length, 1);
});

test('work mode quietly stores text and /add immediately submits a combined request', async (t) => {
  const f = fixture(t), runtime = f.create();
  await runtime.handleInboundEvent(f.event('base requirement'));
  assert.equal(f.sent.length, 0);
  assert.equal(f.seen.length, 0);
  await runtime.handleInboundEvent(f.event('/add and test it'));
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0].text, 'base requirement\n\nand test it');
});

test('chat mode sends directly, suppresses per-message receipts and persists independently per chat', async (t) => {
  const f = fixture(t), runtime = f.create();
  await runtime.handleInboundEvent(f.event('/mode chat'));
  f.sent.length = 0;
  await runtime.handleInboundEvent(f.event('hello'));
  assert.equal(f.seen[0].text, 'hello');
  assert.deepEqual(f.sent.map(x => x.content), ['done']);
  await runtime.handleInboundEvent(f.event('/chat new second'));
  await runtime.handleInboundEvent(f.event('work draft'));
  assert.equal(f.seen.length, 1);
  const restored = f.create();
  await restored.handleInboundEvent(f.event('/chat use 主会话'));
  const before = f.sent.length;
  await restored.handleInboundEvent(f.event('hello again'));
  assert.equal(f.seen[1].text, 'hello again');
  assert.equal(f.sent.length, before + 1);
  await restored.handleInboundEvent(f.event('@second /pending'));
  assert.match(f.sent.at(-1).content, /work draft/);
});

test('switching modes never sends or drops an existing draft without a subsequent message', async (t) => {
  const f = fixture(t), runtime = f.create();
  await runtime.handleInboundEvent(f.event('saved requirement'));
  await runtime.handleInboundEvent(f.event('/mode chat'));
  assert.equal(f.seen.length, 0);
  await runtime.handleInboundEvent(f.event('now continue'));
  assert.equal(f.seen[0].text, 'saved requirement\n\nnow continue');
  await runtime.handleInboundEvent(f.event('/mode work'));
  await runtime.handleInboundEvent(f.event('wait for send'));
  assert.equal(f.seen.length, 1);
  await runtime.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen[1].text, 'wait for send');
});

test('chat files wait for explanatory text and failed attachments still produce an explicit warning', async (t) => {
  const f = fixture(t), runtime = f.create();
  await runtime.handleInboundEvent(f.event('/mode 聊天'));
  f.sent.length = 0;
  await runtime.handleInboundEvent(f.event('', [f.file]));
  assert.equal(f.sent.length, 0);
  assert.equal(f.seen.length, 0);
  await runtime.handleInboundEvent(f.event('analyze the backup'));
  assert.equal(f.seen[0].attachments[0].localPath, f.filePath);
  const failed = f.event('bad transfer');
  failed.metadata.weixin.attachmentErrors = ['weixin_media:unavailable'] as any;
  await runtime.handleInboundEvent(failed);
  assert.equal(f.seen.length, 1);
  assert.match(f.sent.at(-1).content, /附件接收失败/);
});

test('chat follow-ups steer the active task without another turn or system receipt', async (t) => {
  const f = fixture(t), additions: any[] = [];
  const runtime = f.create(undefined, async event => { additions.push(event); return { status: 'accepted' }; });
  await runtime.handleInboundEvent(f.event('/mode chat'));
  f.sent.length = 0;
  f.busy(true);
  await runtime.handleInboundEvent(f.event('also include examples', [f.file]));
  assert.equal(additions[0].text, 'also include examples');
  assert.equal(additions[0].attachments.length, 1);
  assert.equal(f.seen.length, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(runtime.inboundDrafts.get('owner'), undefined);
});

test('work /send and /add steer while normal text remains a quiet draft', async (t) => {
  const f = fixture(t), additions: any[] = [];
  const runtime = f.create(undefined, async event => { additions.push(event); return { status: 'accepted' }; });
  f.busy(true);
  await runtime.handleInboundEvent(f.event('one'));
  assert.equal(additions.length, 0);
  await runtime.handleInboundEvent(f.event('/send two'));
  assert.equal(additions[0].text, 'one\n\ntwo');
  await runtime.handleInboundEvent(f.event('/add three'));
  assert.equal(additions[1].text, 'three');
  assert.equal(f.seen.length, 0);
});

test('uncertain steer failures keep the draft without silently retrying or starting another task', async (t) => {
  const f = fixture(t), runtime = f.create(undefined, async () => ({ status: 'failed' }));
  await runtime.handleInboundEvent(f.event('/mode chat'));
  f.busy(true);
  await runtime.handleInboundEvent(f.event('important correction'));
  assert.equal(f.seen.length, 0);
  assert.equal(runtime.inboundDrafts.get('owner')?.text, 'important correction');
  assert.match(f.sent.at(-1).content, /未能确认/);
});

test('unsupported steering queues behind the active task and /stop cancels the queue into a draft', async (t) => {
  const f = fixture(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = f.create(async event => {
    if (event.text === 'first') await gate;
    return { type: 'message', messages: [{ text: 'done' }] };
  }, async () => ({ status: 'unsupported' }));
  await runtime.handleInboundEvent(f.event('/mode chat'));
  const first = await runtime.dispatchInboundEvent(f.event('first'));
  await new Promise(setImmediate);
  const queued = await runtime.dispatchInboundEvent(f.event('second'));
  assert.equal(f.seen.length, 1);
  await runtime.dispatchInboundEvent(f.event('/stop'));
  release();
  await Promise.all([first.completion, queued.completion]);
  assert.deepEqual(f.seen.map(e => e.text), ['first', '/stop']);
  assert.equal(runtime.inboundDrafts.get('owner')?.text, 'second');
  await runtime.handleInboundEvent(f.event('/send'));
  assert.equal(f.seen.at(-1).text, 'second');
});

test('queued input starts after the previous reply without a second manual /send', async (t) => {
  const f = fixture(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = f.create(async event => {
    if (event.text === 'first') await gate;
    return { type: 'message', messages: [{ text: 'done' }] };
  }, async () => ({ status: 'unsupported' }));
  await runtime.handleInboundEvent(f.event('/mode chat'));
  const first = await runtime.dispatchInboundEvent(f.event('first'));
  await new Promise(setImmediate);
  const queued = await runtime.dispatchInboundEvent(f.event('second'));
  assert.equal(f.seen.length, 1);
  release();
  await Promise.all([first.completion, queued.completion]);
  assert.deepEqual(f.seen.map(e => e.text), ['first', 'second']);
});
