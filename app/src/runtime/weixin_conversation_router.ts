import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { InboundTextEvent } from '../types/platform.js';
import { WEIXIN_CONVERSATION_HELP as HELP } from '../core/weixin_conversation_help.js';

interface Conversation {
  name: string;
  scopeId: string;
  archivedAt?: number | null;
}

interface ConversationGroup {
  recipientId: string;
  activeScopeId: string;
  conversations: Conversation[];
  commandReceipts?: Array<{ messageId: string; reply: { externalScopeId: string; content: string } }>;
}

interface RouterState {
  version: 1;
  groups: ConversationGroup[];
}

export type ConversationRoute =
  | { event: InboundTextEvent; reply?: never }
  | { reply: { externalScopeId: string; content: string }; event?: never };

/** Logical scopes are separate from the authenticated WeChat recipient. */
export class WeixinConversationRouter {
  private state: RouterState;

  constructor(private readonly filePath: string) {
    if (!fs.existsSync(filePath)) {
      this.state = { version: 1, groups: [] };
      return;
    }
    try {
      this.state = this.readState(filePath);
    } catch (error) {
      if (!fs.existsSync(`${filePath}.bak`)) throw error;
      this.state = this.readState(`${filePath}.bak`);
      fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      fs.copyFileSync(`${filePath}.bak`, filePath);
      process.stderr.write('[weixin-conversations] Recovered conversation state from its local backup.\n');
    }
  }

  route(event: InboundTextEvent, isBusy: (scopeId: string) => boolean = () => false): ConversationRoute {
    const group = this.ensureGroup(event.externalScopeId);
    const text = String(event.text ?? '').trim();
    const management = /^\/(?:chat|chats)(?:\s+([\s\S]*))?$/iu.exec(text);
    if (management) {
      const messageId = String((event.metadata?.weixin as any)?.messageId ?? '');
      const previous = messageId ? group.commandReceipts?.find((receipt) => receipt.messageId === messageId) : null;
      if (previous) return { reply: previous.reply };
      const result = this.manage(group, event, management[1] ?? '', isBusy);
      if (messageId && result.reply) {
        group.commandReceipts = [...(group.commandReceipts ?? []), { messageId, reply: result.reply }].slice(-128);
      }
      this.save();
      return result;
    }

    let conversation = this.active(group);
    let routedText = event.text;
    const targeted = /^@([^\s]+)(?:\s+([\s\S]*))?$/u.exec(text);
    if (targeted) {
      const matched = group.conversations.find((candidate) => candidate.name === targeted[1] && !candidate.archivedAt);
      // Unknown @mentions still reach the provider (e.g. plugin or code references).
      if (matched) {
        conversation = matched;
        routedText = targeted[2] ?? '';
        if (!routedText.trim() && !event.attachments?.length) {
          return this.reply(group, `请在 @${conversation.name} 后加上消息内容；切换请用 /chat use ${conversation.name}。`);
        }
      }
    }
    return this.targetEvent(group, conversation, event, routedText);
  }

  private targetEvent(group: ConversationGroup, conversation: Conversation, event: InboundTextEvent, text: string): ConversationRoute {
    return {
      event: {
        ...event,
        text,
        externalScopeId: conversation.scopeId,
        metadata: {
          ...event.metadata,
          weixinConversation: { recipientId: group.recipientId, name: conversation.name },
        },
      },
    };
  }

  private manage(group: ConversationGroup, event: InboundTextEvent, argumentsText: string, isBusy: (scopeId: string) => boolean): ConversationRoute {
    const targetedSend = /^send\s+(\S+)\s+([\s\S]+)$/iu.exec(argumentsText.trim());
    if (targetedSend) {
      const target = group.conversations.find((candidate) => candidate.name === targetedSend[1] && !candidate.archivedAt);
      return target ? this.targetEvent(group, target, event, targetedSend[2])
        : this.reply(group, '找不到这个聊天。请用 /chat list 查看；已归档的聊天需要先恢复。');
    }
    if (event.attachments?.length) {
      return this.reply(group, '聊天管理命令请单独发送；请先切换聊天，再发送图片或文件。');
    }
    const [action = '', ...parts] = argumentsText.trim().split(/\s+/u);
    const name = parts.join(' ');
    switch (action.toLowerCase()) {
      case '':
      case 'help':
        return this.reply(group, `当前聊天：${this.active(group).name}\n\n${HELP}`);
      case 'list': {
        const archived = parts[0]?.toLowerCase() === 'archived';
        const pageText = parts[archived ? 1 : 0] ?? '1';
        if (!/^\d+$/u.test(pageText)) return this.reply(group, '用法：/chat list [页码] 或 /chat list archived [页码]');
        const conversations = group.conversations.filter((conversation) => Boolean(conversation.archivedAt) === archived);
        const pageSize = 20;
        const pageCount = Math.max(1, Math.ceil(conversations.length / pageSize));
        const page = Number(pageText);
        if (page < 1 || page > pageCount) return this.reply(group, `页码应为 1–${pageCount}。`);
        const lines = conversations.slice((page - 1) * pageSize, page * pageSize).map((conversation, index) =>
          `${(page - 1) * pageSize + index + 1}. ${conversation.name}${conversation.scopeId === group.activeScopeId ? ' ← 当前' : ''} · ${isBusy(conversation.scopeId) ? '运行中' : archived ? '已归档' : '空闲'}`,
        );
        return this.reply(group, `${archived ? '已归档聊天' : '聊天列表'} · ${page}/${pageCount} 页 · 共 ${conversations.length} 个\n${lines.join('\n') || '暂无聊天'}\n\n/chat new 名字 新建；/chat use 名字 切换。`);
      }
      case 'new': {
        const nextName = name || this.nextName(group);
        const issue = this.validateName(group, nextName);
        if (issue) return this.reply(group, issue);
        const conversation = {
          name: nextName,
          scopeId: `${group.recipientId}::cbchat:${crypto.randomUUID()}`,
        };
        group.conversations.push(conversation);
        group.activeScopeId = conversation.scopeId;
        return this.reply(group, `已新建并切换到「${nextName}」。发送消息开始独立对话，其他聊天的任务会继续运行。`);
      }
      case 'use': {
        const conversation = group.conversations.find((candidate) => candidate.name === name && !candidate.archivedAt);
        if (!conversation) return this.reply(group, `没有名为「${name}」的聊天。用 /chat list 查看，或 /chat new 名字 新建。`);
        group.activeScopeId = conversation.scopeId;
        return this.reply(group, `已切换到「${conversation.name}」。其他聊天的任务会继续运行。`);
      }
      case 'rename': {
        const issue = this.validateName(group, name);
        if (issue) return this.reply(group, issue);
        this.active(group).name = name;
        return this.reply(group, `当前聊天已改名为「${name}」。`);
      }
      case 'archive': {
        const conversation = group.conversations.find((candidate) => candidate.name === name && !candidate.archivedAt);
        if (!conversation) return this.reply(group, '找不到这个聊天，请用 /chat list 查看。');
        if (isBusy(conversation.scopeId)) return this.reply(group, '这个聊天仍有任务或附件待处理，请等完成或停止后再归档。');
        const remaining = group.conversations.filter((candidate) => !candidate.archivedAt && candidate !== conversation);
        if (!remaining.length) return this.reply(group, '至少需要保留一个可用聊天。');
        conversation.archivedAt = Date.now();
        if (group.activeScopeId === conversation.scopeId) group.activeScopeId = remaining[0].scopeId;
        return this.reply(group, `已归档「${name}」，历史保留。用 /chat restore ${name} 恢复。`);
      }
      case 'restore': {
        const conversation = group.conversations.find((candidate) => candidate.name === name && candidate.archivedAt);
        if (!conversation) return this.reply(group, '找不到这个已归档聊天，请用 /chat list archived 查看。');
        delete conversation.archivedAt;
        return this.reply(group, `已恢复「${name}」。用 /chat use ${name} 切换。`);
      }
      default:
        return this.reply(group, HELP);
    }
  }

  deliveryTarget(scopeId: string): { recipientId: string; label: string } {
    for (const group of this.state.groups) {
      const conversation = group.conversations.find((candidate) => candidate.scopeId === scopeId);
      if (conversation) {
        return { recipientId: group.recipientId, label: group.conversations.length > 1 ? `【${conversation.name}】` : '' };
      }
    }
    return { recipientId: scopeId, label: '' };
  }

  private ensureGroup(recipientId: string): ConversationGroup {
    let group = this.state.groups.find((candidate) => candidate.recipientId === recipientId);
    if (!group) {
      group = { recipientId, activeScopeId: recipientId, conversations: [{ name: '主会话', scopeId: recipientId }] };
      this.state.groups.push(group);
      this.save();
    }
    return group;
  }

  private active(group: ConversationGroup): Conversation {
    const active = group.conversations.find((conversation) => conversation.scopeId === group.activeScopeId && !conversation.archivedAt);
    if (!active) throw new Error('Current WeChat conversation is missing from persisted state.');
    return active;
  }

  private reply(group: ConversationGroup, content: string): ConversationRoute {
    return { reply: { externalScopeId: group.activeScopeId, content } };
  }

  private validateName(group: ConversationGroup, name: string): string | null {
    if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(name)) return '聊天名请用 1–32 个汉字、字母、数字、下划线或短横线，不能包含空格。';
    if (group.conversations.some((conversation) => conversation.name === name)) return `「${name}」已经存在。用 /chat use ${name} 切换。`;
    return null;
  }

  private nextName(group: ConversationGroup): string {
    let index = group.conversations.length + 1;
    while (group.conversations.some((conversation) => conversation.name === `聊天${index}`)) index++;
    return `聊天${index}`;
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, `${this.filePath}.bak`);
    fs.renameSync(temporaryPath, this.filePath);
  }

  private readState(filePath: string): RouterState {
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RouterState;
    const scopes = new Set<string>();
    const recipients = new Set<string>();
    if (state?.version !== 1 || !Array.isArray(state.groups)) throw new Error('Invalid conversation state version.');
    for (const group of state.groups) {
      if (!group || typeof group.recipientId !== 'string' || !group.recipientId || recipients.has(group.recipientId)
        || !Array.isArray(group.conversations) || !group.conversations.length) throw new Error('Invalid conversation group.');
      recipients.add(group.recipientId);
      const names = new Set<string>();
      for (const conversation of group.conversations) {
        if (!conversation || typeof conversation.name !== 'string' || !/^[\p{L}\p{N}_-]{1,32}$/u.test(conversation.name)
          || names.has(conversation.name) || typeof conversation.scopeId !== 'string' || scopes.has(conversation.scopeId)
          || (conversation.scopeId !== group.recipientId && !conversation.scopeId.startsWith(`${group.recipientId}::cbchat:`))) {
          throw new Error('Invalid or duplicate conversation.');
        }
        names.add(conversation.name);
        scopes.add(conversation.scopeId);
      }
      if (!group.conversations.some((conversation) => conversation.scopeId === group.activeScopeId && !conversation.archivedAt)) {
        throw new Error('Current conversation is missing or archived.');
      }
    }
    return state;
  }
}

/** Keep the transport's real recipient, context tokens and delivery receipts intact. */
export function withWeixinConversationDelivery<T extends object>(plugin: T, router: WeixinConversationRouter): T {
  const base = plugin as any;
  const queues = new Map<string, Promise<unknown>>();
  const typingScopes = new Map<string, Set<string>>();
  async function serialized<R>(recipientId: string, send: () => Promise<R>): Promise<R> {
    const previous = queues.get(recipientId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(send);
    queues.set(recipientId, current);
    try { return await current; }
    finally { if (queues.get(recipientId) === current) queues.delete(recipientId); }
  }
  const stripLabel = (text: string, label: string) => label && text.startsWith(label)
    ? text.slice(label.length).trimStart() : text;
  const overrides: Record<string, Function> = {
    async sendText({ externalScopeId, content }: { externalScopeId: string; content: string }) {
      const { recipientId, label } = router.deliveryTarget(externalScopeId);
      return serialized(recipientId, async () => {
        const result = await base.sendText({ externalScopeId: recipientId, content: label ? `${label}\n${content}` : content });
        return result ? { ...result, deliveredText: stripLabel(result.deliveredText ?? '', label), failedText: stripLabel(result.failedText ?? '', label) } : result;
      });
    },
    async sendMedia({ externalScopeId, filePath, caption }: { externalScopeId: string; filePath: string; caption?: string | null }) {
      const { recipientId, label } = router.deliveryTarget(externalScopeId);
      return serialized(recipientId, async () => {
        const result = await base.sendMedia({ externalScopeId: recipientId, filePath, caption: label ? `${label}\n${caption ?? ''}` : caption });
        return result ? { ...result, sentCaption: stripLabel(result.sentCaption ?? '', label) } : result;
      });
    },
    async sendTyping({ externalScopeId, status }: { externalScopeId: string; status: 'start' | 'stop' }) {
      const { recipientId } = router.deliveryTarget(externalScopeId);
      const active = typingScopes.get(recipientId) ?? new Set<string>();
      if (status === 'start') active.add(externalScopeId);
      else active.delete(externalScopeId);
      if (active.size > 0) typingScopes.set(recipientId, active);
      else typingScopes.delete(recipientId);
      if (status === 'start' || active.size === 0) await base.sendTyping?.({ externalScopeId: recipientId, status });
    },
    getStatus({ externalScopeId = null }: { externalScopeId?: string | null } = {}) {
      return base.getStatus?.({ externalScopeId: externalScopeId ? router.deliveryTarget(externalScopeId).recipientId : null });
    },
  };
  // Bind all unchanged methods to the original instance, preserving private state.
  return new Proxy(plugin, {
    get(target, property) {
      if (typeof property === 'string' && Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
