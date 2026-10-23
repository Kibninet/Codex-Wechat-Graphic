import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WeixinConversationRouter, withWeixinConversationDelivery } from '../../src/runtime/weixin_conversation_router.js';
import { WeixinBridgeRuntime } from '../../src/runtime/weixin_bridge_runtime.js';
import type { InboundTextEvent } from '../../src/types/platform.js';

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-chat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'chats.json');
  return { filePath, router: new WeixinConversationRouter(filePath) };
}

function event(text: string, recipient = 'owner'): InboundTextEvent {
  return { platform: 'weixin', externalScopeId: recipient, text, metadata: { weixin: { senderId: recipient } } };
}

function routed(router: WeixinConversationRouter, text: string, recipient = 'owner') {
  const result = router.route(event(text, recipient));
  assert.ok(result.event);
  return result.event;
}

function receipt(content: string) {
  return { success: true, deliveredCount: 1, deliveredText: content, failedIndex: null, failedText: '', error: '' };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

test('keeps the original thread scope and persists an arbitrary number of named chats', (t) => {
  const { router, filePath } = fixture(t);
  assert.equal(routed(router, 'original').externalScopeId, 'owner');
  const ids = new Set(['owner']);
  for (let index = 0; index < 24; index++) {
    router.route(event(`/chat new 任务${index}`));
    ids.add(routed(router, 'next').externalScopeId);
  }
  assert.equal(ids.size, 25);
  const last = routed(router, 'last').externalScopeId;
  const restored = new WeixinConversationRouter(filePath);
  assert.equal(routed(restored, 'after restart').externalScopeId, last);
  restored.route(event('/chat use 主会话'));
  assert.equal(routed(restored, 'old history').externalScopeId, 'owner');
  assert.equal(restored.deliveryTarget(last).label, '【任务23】');
});

test('targets prompts, commands and attachments without changing the selected chat', (t) => {
  const { router } = fixture(t);
  router.route(event('/chat new 逆向'));
  const reverseScope = routed(router, 'hello').externalScopeId;
  router.route(event('/chat new 闲聊'));
  const selected = routed(router, 'hello').externalScopeId;
  const attachment = { kind: 'image' as const, localPath: 'C:/sample.png' };
  const result = router.route({ ...event('@逆向 /stop'), attachments: [attachment] });
  assert.equal(result.event?.externalScopeId, reverseScope);
  assert.equal(result.event?.text, '/stop');
  assert.deepEqual(result.event?.attachments, [attachment]);
  assert.deepEqual(result.event?.metadata?.weixin, { senderId: 'owner' });
  assert.equal(routed(router, 'still selected').externalScopeId, selected);
  assert.equal(routed(router, '@unknown leave plugin reference alone').text, '@unknown leave plugin reference alone');
});

test('paginates chat lists and rejects invalid pages without imposing a chat limit', (t) => {
  const { router } = fixture(t);
  for (let index = 0; index < 25; index++) router.route(event(`/chat new 工作${index}`));
  const first = router.route(event('/chat list')).reply!.content;
  const second = router.route(event('/chat list 2')).reply!.content;
  assert.match(first, /1\/2 页 · 共 26 个/);
  assert.doesNotMatch(first, /工作24/);
  assert.match(second, /26\. 工作24/);
  assert.match(router.route(event('/chat list 0')).reply!.content, /页码应为/);
  assert.match(router.route(event('/chat list nope')).reply!.content, /用法/);
});

test('archives only idle chats, keeps their bindings, and restores them after restart', (t) => {
  const { router, filePath } = fixture(t);
  router.route(event('/chat new 项目'));
  const original = routed(router, 'hi').externalScopeId;
  const busy = router.route(event('/chat archive 项目'), (scopeId) => scopeId === original);
  assert.match(busy.reply!.content, /仍有任务/);
  router.route(event('/chat archive 项目'));
  assert.equal(routed(router, 'fallback').externalScopeId, 'owner');
  assert.match(router.route(event('/chat list archived')).reply!.content, /项目/);
  assert.doesNotMatch(router.route(event('/chat list')).reply!.content, /项目/);
  assert.match(router.route(event('/chat archive 主会话')).reply!.content, /至少需要保留/);
  const restored = new WeixinConversationRouter(filePath);
  restored.route(event('/chat restore 项目'));
  restored.route(event('/chat use 项目'));
  assert.equal(routed(restored, 'continued').externalScopeId, original);
});

test('explicit send preserves multiline content and attachments without changing selection', (t) => {
  const { router } = fixture(t);
  router.route(event('/chat new 项目'));
  const target = routed(router, 'hi').externalScopeId;
  router.route(event('/chat use 主会话'));
  const attachment = { kind: 'file' as const, localPath: 'sample.txt' };
  const result = router.route({ ...event('/chat send 项目 第一行\n第二行'), attachments: [attachment] });
  assert.equal(result.event!.externalScopeId, target);
  assert.equal(result.event!.text, '第一行\n第二行');
  assert.deepEqual(result.event!.attachments, [attachment]);
  assert.equal(routed(router, 'still main').externalScopeId, 'owner');
  assert.match(router.route(event('/chat send missing text')).reply!.content, /找不到/);
});

test('recovers a corrupted state from the previous atomic backup and preserves the corrupt file', (t) => {
  const { router, filePath } = fixture(t);
  router.route(event('/chat new 项目'));
  router.route(event('/chat list'));
  const scopeId = routed(router, 'before').externalScopeId;
  fs.writeFileSync(filePath, '{broken');
  const restored = new WeixinConversationRouter(filePath);
  assert.equal(routed(restored, 'after').externalScopeId, scopeId);
  assert.ok(fs.readdirSync(path.dirname(filePath)).some((name) => name.includes('.corrupt-')));
});

test('replayed management messages do not create extra chats or undo a later selection', (t) => {
  const { router, filePath } = fixture(t);
  const command = { ...event('/chat new'), metadata: { weixin: { messageId: 'command-1' } } };
  const first = router.route(command);
  router.route(event('/chat new 后来的聊天'));
  const activeScope = routed(router, 'hi').externalScopeId;
  const restored = new WeixinConversationRouter(filePath);
  assert.deepEqual(restored.route(command), first);
  assert.equal(routed(restored, 'still selected').externalScopeId, activeScope);
  const list = restored.route(event('/chat list')).reply!.content;
  assert.match(list, /3\. 后来的聊天/);
  assert.doesNotMatch(list, /4\./);
});

test('isolates owners, validates names, renames without losing scope and never forwards management commands', (t) => {
  const { router } = fixture(t);
  const created = router.route(event('/chat new 测试'));
  assert.ok(created.reply);
  const scopeId = routed(router, 'hi').externalScopeId;
  assert.match(router.route(event('/chat new 测试')).reply!.content, /已经存在/);
  assert.match(router.route(event('/chat new ../escape')).reply!.content, /聊天名/);
  assert.match(router.route(event('/chat use missing')).reply!.content, /没有名为/);
  router.route(event('/chat rename 改名'));
  assert.equal(routed(router, '@改名 hi').externalScopeId, scopeId);
  const other = router.route(event('/chat list', 'other'));
  assert.doesNotMatch(other.reply!.content, /改名/);
  assert.equal(router.deliveryTarget(scopeId).recipientId, 'owner');
  assert.equal(routed(router, 'other hi', 'other').externalScopeId, 'other');
});

test('routes all delivery paths to the real recipient and strips labels from partial receipts', async (t) => {
  const { router } = fixture(t);
  router.route(event('/chat new 逆向'));
  const scopeId = routed(router, 'hello').externalScopeId;
  const textCalls: any[] = [];
  const mediaCalls: any[] = [];
  const statusCalls: any[] = [];
  const plugin = withWeixinConversationDelivery({
    id: 'weixin',
    async sendText(payload: any) {
      textCalls.push(payload);
      return { ...receipt('【逆向】\n第一段'), success: false, failedText: '第二段' };
    },
    async sendMedia(payload: any) { mediaCalls.push(payload); return { sentCaption: payload.caption }; },
    getStatus(payload: any) { statusCalls.push(payload); return { data: { hasContextToken: true } }; },
  }, router);
  const result = await plugin.sendText({ externalScopeId: scopeId, content: '第一段第二段' });
  assert.equal(result.deliveredText, '第一段');
  assert.equal(result.failedText, '第二段');
  assert.deepEqual(textCalls, [{ externalScopeId: 'owner', content: '【逆向】\n第一段第二段' }]);
  await plugin.sendMedia({ externalScopeId: scopeId, filePath: 'C:/result.txt', caption: '附件' });
  assert.equal(mediaCalls[0].externalScopeId, 'owner');
  assert.equal(mediaCalls[0].caption, '【逆向】\n附件');
  assert.equal(plugin.getStatus({ externalScopeId: scopeId }).data.hasContextToken, true);
  assert.deepEqual(statusCalls, [{ externalScopeId: 'owner' }]);
});

test('serializes whole messages and keeps typing active while another chat is running', async (t) => {
  const { router } = fixture(t);
  router.route(event('/chat new A'));
  const a = routed(router, 'a').externalScopeId;
  router.route(event('/chat new B'));
  const b = routed(router, 'b').externalScopeId;
  const hold = deferred();
  const started = deferred();
  const order: string[] = [];
  const typing: any[] = [];
  const plugin = withWeixinConversationDelivery({
    async sendText({ content }: any) {
      order.push(content);
      if (order.length === 1) { started.resolve(); await hold.promise; }
      return receipt(content);
    },
    async sendTyping(payload: any) { typing.push(payload); },
  }, router);
  const first = plugin.sendText({ externalScopeId: a, content: 'one' });
  await started.promise;
  const second = plugin.sendText({ externalScopeId: b, content: 'two' });
  await new Promise(setImmediate);
  assert.equal(order.length, 1);
  hold.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['【A】\none', '【B】\ntwo']);
  await plugin.sendTyping({ externalScopeId: a, status: 'start' });
  await plugin.sendTyping({ externalScopeId: b, status: 'start' });
  await plugin.sendTyping({ externalScopeId: a, status: 'stop' });
  assert.equal(typing.length, 2);
  await plugin.sendTyping({ externalScopeId: b, status: 'stop' });
  assert.deepEqual(typing[2], { externalScopeId: 'owner', status: 'stop' });
});

test('runtime runs named chats concurrently and labels late replies with their originating chat', async (t) => {
  const { router } = fixture(t);
  const releases = new Map<string, ReturnType<typeof deferred>>();
  const starts: any[] = [];
  const stops: string[] = [];
  const sent: any[] = [];
  const plugin = withWeixinConversationDelivery({
    async start() {}, async stop() {}, async pollOnce() { return { events: [] }; },
    async sendText(payload: any) { sent.push(payload); return receipt(payload.content); },
  }, router);
  const runtime = new WeixinBridgeRuntime({
    requireSendCommand: false,
    platformPlugin: plugin,
    conversationRouter: router,
    previewIntervalMs: 0,
    bridgeCoordinator: {
      async handleInboundEvent(input: any) {
        if (input.text === '/stop') {
          stops.push(input.externalScopeId);
          releases.get(input.externalScopeId)?.resolve();
          return { type: 'message', messages: [{ text: '已停止' }] };
        }
        starts.push(input);
        const hold = deferred();
        releases.set(input.externalScopeId, hold);
        await hold.promise;
        return { type: 'message', messages: [{ text: `结果：${input.text}` }] };
      },
    },
  });
  await runtime.dispatchInboundEvent(event('/chat new A'));
  const a = await runtime.dispatchInboundEvent(event('任务A'));
  await new Promise(setImmediate);
  await runtime.dispatchInboundEvent(event('/chat new B'));
  const b = await runtime.dispatchInboundEvent(event('任务B'));
  await new Promise(setImmediate);
  assert.equal(starts.length, 2, 'B must start before A completes');
  assert.notEqual(starts[0].externalScopeId, starts[1].externalScopeId);
  await runtime.dispatchInboundEvent(event('/chat list'));
  assert.match(sent.at(-1).content, /A · 运行中/);
  assert.match(sent.at(-1).content, /B ← 当前 · 运行中/);
  await runtime.dispatchInboundEvent(event('@A /stop'));
  assert.deepEqual(stops, [starts[0].externalScopeId]);
  assert.equal(releases.size, 2);
  releases.get(starts[1].externalScopeId)!.resolve();
  await Promise.all([a.completion, b.completion]);
  await runtime.waitForIdle();
  assert.ok(sent.some((message) => message.content === '【A】\n结果：任务A'));
  assert.ok(sent.some((message) => message.content === '【B】\n结果：任务B'));
  assert.ok(sent.every((message) => message.externalScopeId === 'owner'));
});
