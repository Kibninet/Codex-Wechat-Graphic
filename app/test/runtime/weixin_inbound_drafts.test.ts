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
  const create = (handler?: (event: any) => Promise<any>) => new WeixinBridgeRuntime({
    inboundDraftsPath: path.join(root, 'drafts.json'),
    conversationRouter: new WeixinConversationRouter(path.join(root, 'chats.json')),
    isConversationBusy: () => busy,
    typingKeepaliveMs: 0,
    platformPlugin: {
      async start() {}, async stop() {}, async pollOnce() { return { events: [] }; },
      async sendText(message: any) { sent.push(message); return { success: true, deliveredCount: 1, deliveredText: message.content, failedIndex: null, failedText: '', error: '' }; },
    },
    bridgeCoordinator: { async handleInboundEvent(event: any) {
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
  assert.match(f.sent.at(-1).content, /草稿已保留/);
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
