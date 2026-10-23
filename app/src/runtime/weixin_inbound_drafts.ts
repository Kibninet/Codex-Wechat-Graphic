import fs from 'node:fs';
import path from 'node:path';
import type { InboundTextEvent } from '../types/platform.js';

/** Local drafts contain file references, never file payloads or login credentials. */
export class WeixinInboundDrafts {
  private entries = new Map<string, InboundTextEvent>();
  private modes = new Map<string, 'work' | 'chat'>();
  constructor(private readonly filePath?: string | null) {
    if (!filePath || !fs.existsSync(filePath)) return;
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.drafts)) throw new Error('Invalid WeChat draft state.');
    for (const [scope, mode] of state.modes ?? []) {
      if (typeof scope !== 'string' || !['work', 'chat'].includes(mode)) throw new Error('Invalid WeChat mode.');
      this.modes.set(scope, mode);
    }
    for (const event of state.drafts) {
      if (!event || typeof event.externalScopeId !== 'string' || typeof event.text !== 'string'
        || (event.attachments !== undefined && !Array.isArray(event.attachments))) {
        throw new Error('Invalid WeChat draft entry.');
      }
      this.entries.set(event.externalScopeId, event);
    }
  }
  get(scopeId: string): InboundTextEvent | undefined { return this.entries.get(scopeId); }
  mode(scopeId: string): 'work' | 'chat' { return this.modes.get(scopeId) ?? 'work'; }
  setMode(scopeId: string, mode: 'work' | 'chat'): void {
    const previous = this.modes.get(scopeId);
    this.modes.set(scopeId, mode);
    try { this.save(); } catch (error) {
      if (previous) this.modes.set(scopeId, previous);
      else this.modes.delete(scopeId);
      throw error;
    }
  }
  set(event: InboundTextEvent): void {
    const previous = this.entries.get(event.externalScopeId);
    this.entries.set(event.externalScopeId, event);
    try { this.save(); } catch (error) {
      if (previous) this.entries.set(event.externalScopeId, previous);
      else this.entries.delete(event.externalScopeId);
      throw error;
    }
  }
  delete(scopeId: string): void {
    const previous = this.entries.get(scopeId);
    this.entries.delete(scopeId);
    try { this.save(); } catch (error) {
      if (previous) this.entries.set(scopeId, previous);
      throw error;
    }
  }
  private save(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(`${this.filePath}.tmp`, JSON.stringify({ version: 1, drafts: [...this.entries.values()], modes: [...this.modes] }), { mode: 0o600 });
    fs.renameSync(`${this.filePath}.tmp`, this.filePath);
  }
}
