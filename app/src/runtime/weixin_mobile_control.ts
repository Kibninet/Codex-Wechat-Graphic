import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import type { InboundTextEvent } from '../types/platform.js';
import type { WeixinConversationRouter } from './weixin_conversation_router.js';
import type { WeixinBridgeRuntime } from './weixin_bridge_runtime.js';
import { MOBILE_COMMANDS, buildMobileCommand } from '../core/mobile_command_catalog.js';
import { formatPlatformScopeKey } from '../core/contracts.js';

const conversationId = (scope: string) => crypto.createHash('sha256').update(scope).digest('hex').slice(0, 32);

/** Controls the running WeChat runtime; never creates another model client. */
export class WeixinMobileController {
  private jobs = new Map<string, { error: string | null; submittedAt: number; pending: boolean }>();
  private actionJobs = new Map<string,{id:string;threadId:string;state:string;text:string;startedAt:number;error:string|null;choices?:any[]}>();
  constructor(private options: { stateDir: string; ownerId: string; conversationRouter: WeixinConversationRouter; bridgeRuntime: WeixinBridgeRuntime; runtime: any }) {}
  private scopeRef(scope: string) { return { platform: 'weixin', externalScopeId: scope }; }
  private selected(id?: string, includeArchived = false) {
    const state = this.options.conversationRouter.snapshotForRecipient(this.options.ownerId);
    const found = state.conversations.find(c => (includeArchived || !c.archivedAt) && (id ? conversationId(c.scopeId) === id : c.scopeId === state.activeScopeId));
    if (!found) throw new Error('未找到这个微信聊天');
    return found;
  }
  private baseEvent(text: string, messageId: string = crypto.randomUUID()): InboundTextEvent {
    return { platform: 'weixin', externalScopeId: this.options.ownerId, text,
      metadata: { weixin: { senderId: this.options.ownerId, chatType: 'private', messageId }, mobileControl: true } };
  }
  private targetEvent(id: string, text: string): InboundTextEvent {
    const c = this.selected(id);
    return { ...this.baseEvent(text), externalScopeId: c.scopeId,
      metadata: { mobileControl: true, weixinConversation: { recipientId: this.options.ownerId, name: c.name } } };
  }
  private busy(scope: string) {
    return this.options.bridgeRuntime.scopeChains.has(scope) || this.options.bridgeRuntime.isConversationBusy(scope);
  }
  state(includeArchived = false) {
    const { ownerId, conversationRouter, runtime, bridgeRuntime } = this.options;
    const group = conversationRouter.snapshotForRecipient(ownerId);
    return group.conversations.filter(c => includeArchived || !c.archivedAt).map(c => {
      const session = runtime.services.bridgeSessions.resolveScopeSession(this.scopeRef(c.scopeId));
      const settings = session ? runtime.services.bridgeSessions.getSessionSettings(session.id) : null;
      const active = runtime.services.activeTurns.resolveScopeTurn(this.scopeRef(c.scopeId));
      const draft = bridgeRuntime.inboundDrafts.get(c.scopeId);
      const id = conversationId(c.scopeId);
      return { threadId: id, title: c.name, cwd:session?.cwd||null, archivedAt:c.archivedAt||null, selected: c.scopeId === group.activeScopeId, codexThreadId: session?.codexThreadId || null,
        updatedAt: session?.updatedAt || 0, settings: { model: settings?.model || null, reasoningEffort: settings?.reasoningEffort || null },
        mode: bridgeRuntime.inboundDrafts.mode(c.scopeId), activeRunId: this.busy(c.scopeId) ? id : null,
        startedAt: active?.createdAt || null, pendingText: draft?.text || '', pendingFileCount: draft?.attachments?.length || 0,
        pendingFiles:(draft?.attachments||[]).map(a=>({name:a.fileName||path.basename(a.localPath||'attachment'),kind:a.kind})) };
    });
  }
  async models(id?: string) {
    const c = this.selected(id); const ref = this.scopeRef(c.scopeId); const runtime = this.options.runtime;
    const profile = runtime.services.bridgeCoordinator.resolveScopeProviderProfile(ref);
    return runtime.registry.getProvider(profile.providerKind).listModels({ providerProfile: profile });
  }
  private loadFiles(ids: unknown) {
    if (ids === undefined) return [];
    if (!Array.isArray(ids) || ids.length > 20) throw new Error('一次最多 20 个附件');
    const root = path.join(this.options.stateDir, 'mobile', 'uploads');
    return ids.map(id => {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('附件编号无效');
      const info = JSON.parse(fs.readFileSync(path.join(root, id + '.json'), 'utf8'));
      if (!new RegExp('^' + id + '\\.[a-z0-9]{1,16}$','i').test(info.diskName || '')) throw new Error('附件信息无效');
      const localPath = path.join(root, info.diskName);
      if (fs.statSync(localPath).size !== info.size || info.size > 100*1024*1024) throw new Error('文件未完整上传');
      return { kind: String(info.mimeType).startsWith('image/') ? 'image' as const : 'file' as const, fileName: info.name, localPath, mimeType: info.mimeType };
    });
  }
  async dispatch(action: string, input: any = {}) {
    const { conversationRouter, bridgeRuntime, runtime } = this.options;
    if(action === 'commands')return MOBILE_COMMANDS;
    if(action === 'action-result'){
      const job=this.actionJobs.get(String(input.requestId));if(!job)throw new Error('操作记录不存在或桥接已重启，请先检查原微信状态再决定是否重试');return job;
    }
    if (action === 'state') return this.state();
    if (action === 'archived') return this.state(true).filter(c=>c.archivedAt);
    if (action === 'models') return this.models(input.id);
    if (action === 'new' || action === 'select') {
      const text = action === 'new' ? '/chat new' + (input.name ? ' ' + String(input.name) : '') : '/chat use ' + this.selected(input.id).name;
      const routed = conversationRouter.route(this.baseEvent(text), scope => this.busy(scope), scope => Boolean(bridgeRuntime.inboundDrafts.get(scope)));
      const state = this.state(); const current = state.find(c => c.selected)!;
      if (action === 'new' && !String(routed.reply?.content || '').startsWith('已新建')) throw new Error(routed.reply?.content || '新建失败');
      return current;
    }
    const c = this.selected(input.id,action==='restore'); const ref = this.scopeRef(c.scopeId);
    if(['rename','archive','restore'].includes(action)){
      const command=action==='rename'?`/chat rename ${c.name} ${String(input.name||'')}`:`/chat ${action} ${c.name}`;
      const routed=conversationRouter.route(this.baseEvent(command),scope=>this.busy(scope),scope=>Boolean(bridgeRuntime.inboundDrafts.get(scope)));
      const updated=this.state(true).find(t=>t.threadId===input.id);
      if(action==='rename' ? updated?.title!==input.name : action==='archive' ? !updated?.archivedAt : Boolean(updated?.archivedAt))throw new Error(routed.reply?.content||'操作未完成');
      return updated;
    }
    if(action==='draft-discard'){if(input.confirmed!==true)throw new Error('请确认清空草稿');bridgeRuntime.inboundDrafts.delete(c.scopeId);return this.state().find(t=>t.threadId===input.id);}
    if(action==='command'){
      const built=buildMobileCommand(input.commandId,input.values);const requestId=String(input.requestId||'');
      if(built.definition.id==='new-thread'){
        const cwd=String(input.values?.cwd||'').trim();
        if(cwd&&(!path.isAbsolute(cwd)||!fs.existsSync(cwd)||!fs.statSync(cwd).isDirectory()))throw new Error('项目目录必须是电脑上已存在的绝对目录路径');
      }
      if(!/^[a-z0-9-]{16,80}$/i.test(requestId))throw new Error('操作编号无效');
      if(built.definition.confirm && input.confirmed!==true)throw new Error('请确认此操作的影响');
      if(['allow-once','allow-session','deny'].includes(built.definition.id))throw new Error('请使用任务面板中绑定具体请求的审批按钮，避免批准过期操作');
      const reads=['status','usage','help','login-list','provider-list','models','model-current','permissions','plan','personality','thread-list','thread-next','thread-prev','thread-peek','approvals'];
      if(this.busy(c.scopeId)&&!reads.includes(built.definition.id)&&built.definition.id!=='stop')throw new Error('请等待当前任务完成或先停止，再执行这项管理操作');
      const hash=crypto.createHash('sha256').update(JSON.stringify({id:input.id,commandId:input.commandId,text:built.text})).digest('hex');
      const receipts=path.join(this.options.stateDir,'mobile','action-receipts');fs.mkdirSync(receipts,{recursive:true});const file=path.join(receipts,requestId+'.json');
      if(fs.existsSync(file)){
        if(JSON.parse(fs.readFileSync(file,'utf8')).hash!==hash)throw new Error('操作编号与内容不一致');
        const existing=this.actionJobs.get(requestId);if(!existing)throw new Error('此操作在重启前已受理，请先检查微信状态，未重复执行');return existing;
      }
      fs.writeFileSync(file,JSON.stringify({hash,createdAt:Date.now()}),{flag:'wx'});
      const job={id:requestId,threadId:input.id,state:'running',text:'',startedAt:Date.now(),error:null as string|null,choices:[] as any[]};this.actionJobs.set(requestId,job);
      if(this.actionJobs.size>100)for(const [key,value] of this.actionJobs){if(value.state!=='running'){this.actionJobs.delete(key);break;}}
      const task=(async()=>{
        try{
          const response=built.definition.delivery==='wechat' ? await bridgeRuntime.handleInboundEvent(this.baseEvent(`@${c.name} ${built.text}`,'mobile-action-'+requestId)) : await runtime.services.bridgeCoordinator.handleInboundEvent(this.targetEvent(input.id,built.text),{});
          job.text=(response?.messages||[]).map((m:any)=>m.text||'').join('\n')||'操作已完成；生成内容请在原微信聊天查看。';
          const coordinator=runtime.services.bridgeCoordinator,event=this.targetEvent(input.id,built.text),key=formatPlatformScopeKey(event.platform,event.externalScopeId);
          const kind=['thread-list','thread-next','thread-prev'].includes(built.definition.id)?'thread':/^skills(?:-search|-reload)?$/.test(built.definition.id)?'skills':/^plugins(?:-search|-list)?$/.test(built.definition.id)?'plugins':/^apps(?:-search|-all)?$/.test(built.definition.id)?'apps':built.definition.id==='mcp'?'mcp':null;
          const browser=kind==='thread'?coordinator.getThreadBrowserState?.(event):kind==='skills'?coordinator.skillBrowserStates?.get(key):kind==='plugins'?coordinator.pluginBrowserStates?.get(key):kind==='apps'?coordinator.appBrowserStates?.get(key):kind==='mcp'?coordinator.mcpBrowserStates?.get(key):null;
          job.choices=(browser?.items||[]).slice(0,100).map((item:any)=>({kind,target:item.threadId||item.id||item.name,title:item.title||item.displayName||item.name||item.threadId,description:item.preview||item.shortDescription||item.description||'',enabled:item.enabled??item.isEnabled,installed:item.installed}));
          job.error=response?.meta?.runtimeDelivery?.error||response?.meta?.codexTurn?.errorMessage||null;job.state=job.error?'failed':'completed';return response;
        }catch(e){job.error=e instanceof Error?e.message:'操作失败';job.state='failed';}
      })();bridgeRuntime.trackBackgroundTask(task);return job;
    }
    if (action === 'mode') {
      if (!['work', 'chat'].includes(input.mode)) throw new Error('模式无效');
      bridgeRuntime.inboundDrafts.setMode(c.scopeId, input.mode); return this.state().find(t => t.threadId === input.id);
    }
    if (action === 'settings') {
      if (this.busy(c.scopeId)) throw new Error('微信这个聊天仍有任务运行，请完成或停止后再切换模型');
      const model = typeof input.model === 'string' ? input.model : '';
      const effort = typeof input.reasoningEffort === 'string' ? input.reasoningEffort : '';
      const models = await this.models(input.id);
      const match = models.find((m: any) => m.model === model || m.id === model);
      if (model && !match) throw new Error('当前微信桥接不可用这个模型');
      if (effort && !match?.supportedReasoningEfforts?.includes(effort)) throw new Error('这个模型不支持所选思考强度');
      const event = this.targetEvent(input.id, `/model ${model || 'default'}${effort ? ' '+effort : ''}`);
      const coordinator = runtime.services.bridgeCoordinator;
      const parent = coordinator.resolveConversationParentSession(event);
      await runtime.services.bridgeSessions.resolveOrCreateScopeSession(ref, {
        providerProfileId: parent?.providerProfileId || coordinator.resolveScopeProviderProfile(ref).id,
        cwd: parent?.cwd || runtime.config.defaultCwd, initialSettings: coordinator.resolveConversationParentSettings(event) || {},
      });
      const response = await coordinator.handleInboundEvent(event, {});
      return { ...this.state().find(t => t.threadId === input.id)?.settings,
        message: (response?.messages || []).map((m: any) => m.text || '').join('\n') };
    }
    if (action === 'stop' || action === 'approve') {
      if (action === 'approve' && !['accept','decline'].includes(input.decision)) throw new Error('审批操作无效');
      if (action === 'approve') {
        const active = runtime.services.activeTurns.resolveScopeTurn(ref);
        if (!input.requestId || active?.pendingApprovals?.[0]?.requestId !== input.requestId) throw new Error('审批请求已变化，请刷新后确认当前操作');
      }
      const command = action === 'stop' ? '/stop' : input.decision === 'accept' ? input.remember===true ? '/allow 2' : '/allow 1' : '/deny';
      await bridgeRuntime.handleInboundEvent(this.baseEvent(`@${c.name} ${command}`)); return this.run(input.id);
    }
    if (action === 'run') return this.run(input.id);
    if (action === 'send') {
      const text = typeof input.text === 'string' ? input.text : '';
      if (text.length > 100_000) throw new Error('单轮最多 100000 字');
      const files = this.loadFiles(input.fileIds);
      if (!text.trim() && !files.length && !bridgeRuntime.inboundDrafts.get(c.scopeId)) throw new Error('请先输入要求或选择文件');
      const requestId = String(input.requestId || '');
      if (!/^[a-z0-9-]{16,80}$/i.test(requestId)) throw new Error('提交编号无效');
      const receipts = path.join(this.options.stateDir, 'mobile', 'weixin-receipts'); fs.mkdirSync(receipts,{recursive:true});
      const receiptFile = path.join(receipts, requestId + '.json');
      const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ id: input.id, text, fileIds: input.fileIds || [] })).digest('hex');
      if (fs.existsSync(receiptFile)) {
        const receipt = JSON.parse(fs.readFileSync(receiptFile,'utf8'));
        if (receipt.payloadHash !== payloadHash) throw new Error('提交编号已用于其他内容，请重新编辑后发送');
        if (!this.jobs.has(input.id) && !this.busy(c.scopeId)) throw new Error('上次提交在桥接重启前已受理，请先到微信确认结果；未重复发送');
        return { runId: input.id, continued: receipt.continued, duplicate: true };
      }
      const continued = this.busy(c.scopeId);
      fs.writeFileSync(receiptFile,JSON.stringify({ payloadHash, continued, createdAt:Date.now() }),{flag:'wx'});
      const job = { pending: true, submittedAt: Date.now(), error: null as string|null };
      this.jobs.set(input.id, job);
      const event = { ...this.baseEvent(`/chat send ${c.name} /send ${text}`, 'mobile-' + requestId), attachments: files };
      // Original routing, drafts, steering, approvals and final WeChat delivery stay in charge.
      const task = bridgeRuntime.handleInboundEvent(event);
      bridgeRuntime.trackBackgroundTask(task);
      void task.then(response => {
        job.pending=false; job.error=response?.meta?.runtimeDelivery?.error || response?.meta?.codexTurn?.errorMessage || null;
      }).catch(e=>{job.pending=false;job.error=e.message||'微信桥接提交失败';});
      return { runId: input.id, continued };
    }
    throw new Error('不支持这个微信管理操作');
  }
  run(id: string) {
    const c = this.selected(id); const active = this.options.runtime.services.activeTurns.resolveScopeTurn(this.scopeRef(c.scopeId));
    const job = this.jobs.get(id); const busy = this.busy(c.scopeId) || Boolean(job?.pending);
    return { id, threadId:id, state: job?.error ? 'failed' : active?.pendingApprovals?.length ? 'waiting_approval' : busy ? 'running' : 'completed',
      text: '', commentary: busy ? '当前任务由原微信桥接处理。最终回复会发送到微信。' : '', error:job?.error || null,
      startedAt: active?.createdAt || job?.submittedAt || Date.now(), approvals: (active?.pendingApprovals || []).map((a: any)=>({requestId:a.requestId,kind:a.kind,command:a.command,description:a.description})) };
  }
}

export async function startWeixinMobileControl(options: ConstructorParameters<typeof WeixinMobileController>[0]) {
  const controller = new WeixinMobileController(options); const token = crypto.randomBytes(32).toString('base64url');
  const server = http.createServer(async (request,response) => {
    response.setHeader('Content-Type','application/json; charset=utf-8');
    const supplied=String(request.headers.authorization || '').replace(/^Bearer /,'');
    if (request.method!=='POST' || Buffer.byteLength(supplied)!==Buffer.byteLength(token) || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(token))) {
      response.writeHead(401).end(JSON.stringify({error:'Unauthorized'}));return;
    }
    try {
      request.setEncoding('utf8');
      let bytes=0,body='';for await(const chunk of request){bytes+=Buffer.byteLength(chunk);if(bytes>512*1024)throw new Error('请求过大');body+=chunk;}
      const input=JSON.parse(body);const data=await controller.dispatch(input.action,input.input);response.end(JSON.stringify({data}));
    } catch(e){response.writeHead(400).end(JSON.stringify({error:e instanceof Error?e.message:'操作失败'}));}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  server.requestTimeout=35_000;server.headersTimeout=10_000;
  const address=server.address() as {port:number};
  const file=path.join(options.stateDir,'mobile','weixin-control.json');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify({port:address.port,token,pid:process.pid}),{mode:0o600});
  return { stop:()=>new Promise<void>(resolve=>server.close(()=>resolve())) };
}
