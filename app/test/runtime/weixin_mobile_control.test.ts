import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { WeixinConversationRouter, withWeixinConversationDelivery } from '../../src/runtime/weixin_conversation_router.js';
import { WeixinBridgeRuntime } from '../../src/runtime/weixin_bridge_runtime.js';
import { WeixinMobileController, startWeixinMobileControl } from '../../src/runtime/weixin_mobile_control.js';

function fixture() {
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-control-test-'));
  const ownerId='test-owner'; const router=new WeixinConversationRouter(path.join(stateDir,'conversations.json'));
  const events:any[]=[], deliveries:any[]=[], sessions=new Map(), settings=new Map(), active=new Map();
  const provider={listModels:async()=>[{id:'model-a',model:'model-a',displayName:'Model A',supportedReasoningEfforts:['low','high']}]};
  const coordinator:any={
    resolveScopeProviderProfile:()=>({id:'existing-wechat-provider',providerKind:'openai-native'}),
    resolveConversationParentSession:()=>null,resolveConversationParentSettings:()=>({model:'model-a'}),
    handleInboundEvent:async(event:any)=>{
      events.push(event);
      if(event.text.startsWith('/model ')){
        const s=sessions.get(event.externalScopeId);const [,model,effort]=event.text.split(' ');settings.set(s.id,{model,reasoningEffort:effort||null});
      }
      return {type:'message',messages:[{text:'test reply'}],meta:{codexTurn:{outputState:'complete',finalSource:'thread_items'}}};
    },
  };
  const platform=withWeixinConversationDelivery({start:async()=>{},stop:async()=>{},pollOnce:async()=>({events:[]}),
    sendText:async(data:any)=>{deliveries.push(data);return {success:true,deliveredCount:1,deliveredText:data.content,failedIndex:null,failedText:'',error:''};},
  },router);
  const bridgeRuntime=new WeixinBridgeRuntime({platformPlugin:platform,bridgeCoordinator:coordinator,conversationRouter:router,
    inboundDraftsPath:path.join(stateDir,'drafts.json'),isConversationBusy:scope=>active.has(scope),automationPollMs:0,internalThreadCleanupMs:0} as any);
  const runtime:any={config:{defaultCwd:stateDir},registry:{getProvider:()=>provider},services:{bridgeCoordinator:coordinator,
    activeTurns:{resolveScopeTurn:(ref:any)=>active.get(ref.externalScopeId)||null},
    bridgeSessions:{resolveScopeSession:(ref:any)=>sessions.get(ref.externalScopeId)||null,getSessionSettings:(id:string)=>settings.get(id)||{},
      resolveOrCreateScopeSession:async(ref:any,options:any)=>{if(!sessions.has(ref.externalScopeId)){const s={id:crypto.randomUUID(),codexThreadId:crypto.randomUUID(),providerProfileId:options.providerProfileId};sessions.set(ref.externalScopeId,s);settings.set(s.id,options.initialSettings);}return sessions.get(ref.externalScopeId);}},
  }};
  const options={stateDir,ownerId,conversationRouter:router,bridgeRuntime,runtime};
  const controller=new WeixinMobileController(options);
  const cleanup=()=>{assert.equal(path.dirname(path.resolve(stateDir)),path.resolve(os.tmpdir()));assert.ok(path.basename(stateDir).startsWith('wechat-control-test-'));fs.rmSync(stateDir,{recursive:true,force:true});};
  return {controller,options,router,bridgeRuntime,events,deliveries,sessions,settings,active,stateDir,cleanup};
}

test('phone controls the same WeChat current-chat pointer and supports more than two chats',async()=>{
  const f=fixture();try{
    const original=f.controller.state()[0];
    const added:any=await f.controller.dispatch('new',{name:'Work'});
    await f.controller.dispatch('new',{name:'Notes'});
    assert.equal(f.controller.state().length,3);
    await f.controller.dispatch('select',{id:added.threadId});
    assert.equal(f.router.snapshotForRecipient('test-owner').conversations.find(c=>c.scopeId===f.router.activeScopeForRecipient('test-owner'))?.name,'Work');
    assert.equal(f.events.length,0); // New/switch do not invoke a model or another runtime.
    await f.controller.dispatch('mode',{id:added.threadId,mode:'chat'});
    assert.equal(f.bridgeRuntime.isChatModeForRecipient('test-owner'),true);
    await assert.rejects(f.controller.dispatch('select',{id:'another-owner-scope'}),/未找到/);
    assert.notEqual(original.threadId,added.threadId);
    assert.ok(!JSON.stringify(f.controller.state()).includes('test-owner'));
  }finally{f.cleanup();}
});

test('phone text and files merge with existing WeChat drafts and replies are delivered through WeChat once',async()=>{
  const f=fixture();try{
    const chat=f.controller.state()[0];
    f.bridgeRuntime.inboundDrafts.set({platform:'weixin',externalScopeId:'test-owner',text:'Earlier WeChat text'});
    const id=crypto.randomUUID(),root=path.join(f.stateDir,'mobile/uploads');fs.mkdirSync(root,{recursive:true});
    fs.writeFileSync(path.join(root,id+'.bak'),'backup bytes');fs.writeFileSync(path.join(root,id+'.json'),JSON.stringify({name:'notes.bak',diskName:id+'.bak',size:12,mimeType:'application/octet-stream'}));
    const input={id:chat.threadId,text:'Phone explanation',fileIds:[id],requestId:crypto.randomUUID()};
    await f.controller.dispatch('send',input);
    const duplicate:any=await f.controller.dispatch('send',input);assert.equal(duplicate.duplicate,true);
    await f.bridgeRuntime.waitForIdle();
    assert.equal(f.events.length,1);assert.equal(f.events[0].platform,'weixin');assert.equal(f.events[0].externalScopeId,'test-owner');
    assert.match(f.events[0].text,/Earlier WeChat text/);assert.match(f.events[0].text,/Phone explanation/);
    assert.equal(f.events[0].attachments.length,1);assert.equal(f.events[0].attachments[0].fileName,'notes.bak');
    assert.equal(f.deliveries.length,1);assert.equal(f.deliveries[0].externalScopeId,'test-owner');assert.match(f.deliveries[0].content,/test reply/);
    assert.equal(f.bridgeRuntime.inboundDrafts.get('test-owner'),undefined);
    const restarted=new WeixinMobileController(f.options);
    await assert.rejects(restarted.dispatch('send',input),/重启前已受理/);
    await assert.rejects(f.controller.dispatch('send',{...input,text:'different'}),/其他内容/);
    assert.equal(f.events.length,1);
  }finally{f.cleanup();}
});

test('stop and model updates target the original named WeChat scope',async()=>{
  const f=fixture();try{
    const chat:any=await f.controller.dispatch('new',{name:'Work'});
    const scope=f.router.activeScopeForRecipient('test-owner');
    await f.controller.dispatch('settings',{id:chat.threadId,model:'model-a',reasoningEffort:'high'});
    assert.equal(f.events[0].platform,'weixin');assert.equal(f.events[0].externalScopeId,scope);assert.equal(f.events[0].text,'/model model-a high');
    assert.equal(f.controller.state().find(c=>c.threadId===chat.threadId)?.settings.model,'model-a');
    f.active.set(scope,{createdAt:Date.now(),pendingApprovals:[]});
    await assert.rejects(f.controller.dispatch('settings',{id:chat.threadId,model:'model-a',reasoningEffort:'low'}),/仍有任务/);
    await f.controller.dispatch('stop',{id:chat.threadId});
    assert.equal(f.events.at(-1).text,'/stop');assert.equal(f.events.at(-1).externalScopeId,scope);
    assert.equal(f.deliveries.at(-1).externalScopeId,'test-owner');
  }finally{f.cleanup();}
});

test('local WeChat control socket is authenticated and does not expose owner identifiers',async()=>{
  const f=fixture();const server=await startWeixinMobileControl(f.options);try{
    const connection=JSON.parse(fs.readFileSync(path.join(f.stateDir,'mobile/weixin-control.json'),'utf8'));
    const url=`http://127.0.0.1:${connection.port}/`;
    const denied=await fetch(url,{method:'POST',body:JSON.stringify({action:'state'})});assert.equal(denied.status,401);
    const ok=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+connection.token},body:JSON.stringify({action:'state'})});
    assert.equal(ok.status,200);const response=await ok.text();assert.ok(!response.includes('test-owner'));
    const unsupported=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+connection.token},body:JSON.stringify({action:'arbitrary_shell'})});
    assert.equal(unsupported.status,400);
  }finally{await server.stop();f.cleanup();}
});

test('graphical rename, archive, restore and draft controls preserve original WeChat selection and guards',async()=>{
  const f=fixture();try{
    const work:any=await f.controller.dispatch('new',{name:'Work'});await f.controller.dispatch('new',{name:'Notes'});const selected=f.router.activeScopeForRecipient('test-owner');
    await f.controller.dispatch('rename',{id:work.threadId,name:'Study'});assert.equal(f.router.activeScopeForRecipient('test-owner'),selected);assert.equal(f.controller.state().find(c=>c.threadId===work.threadId)?.title,'Study');
    const workScope=f.router.snapshotForRecipient('test-owner').conversations.find(c=>c.name==='Study')!.scopeId;
    f.bridgeRuntime.inboundDrafts.set({platform:'weixin',externalScopeId:workScope,text:'Keep me'});
    await assert.rejects(f.controller.dispatch('archive',{id:work.threadId}),/草稿/);
    await assert.rejects(f.controller.dispatch('draft-discard',{id:work.threadId}),/确认/);
    await f.controller.dispatch('draft-discard',{id:work.threadId,confirmed:true});
    f.active.set(workScope,{pendingApprovals:[]});await assert.rejects(f.controller.dispatch('archive',{id:work.threadId}),/任务/);f.active.delete(workScope);
    await f.controller.dispatch('archive',{id:work.threadId});assert.equal((await f.controller.dispatch('archived') as any[])[0].title,'Study');
    await f.controller.dispatch('restore',{id:work.threadId});assert.equal(f.controller.state().length,3);assert.equal(f.router.activeScopeForRecipient('test-owner'),selected);assert.equal(f.deliveries.length,0);
  }finally{f.cleanup();}
});

test('graphical commands reuse original coordinator, retain results and deduplicate uncertain retries',async()=>{
  const f=fixture();try{
    const chat=f.controller.state()[0],requestId=crypto.randomUUID();
    const job:any=await f.controller.dispatch('command',{id:chat.threadId,commandId:'status',values:{},requestId});
    await f.bridgeRuntime.waitForIdle();const result:any=await f.controller.dispatch('action-result',{requestId});assert.equal(result.state,'completed');assert.equal(result.text,'test reply');
    await f.controller.dispatch('command',{id:chat.threadId,commandId:'status',values:{},requestId});assert.equal(f.events.length,1);assert.equal(f.events[0].text,'/status');assert.equal(f.events[0].externalScopeId,'test-owner');assert.equal(f.deliveries.length,0);
    await assert.rejects(f.controller.dispatch('command',{id:chat.threadId,commandId:'permissions-set',values:{value:'full-access'},requestId:crypto.randomUUID()}),/确认/);
    await assert.rejects(f.controller.dispatch('command',{id:chat.threadId,commandId:'restart',values:{},requestId}),/确认/);
    assert.equal(job.id,requestId);assert.ok((await f.controller.dispatch('commands') as any[]).length>90);
  }finally{f.cleanup();}
});

test('project-directory action validates local folders and forwards the exact selected path to original /new',async()=>{
  const f=fixture();try{
    const chat=f.controller.state()[0],cwd=path.join(f.stateDir,'Project Notes');fs.mkdirSync(cwd);
    await assert.rejects(f.controller.dispatch('command',{id:chat.threadId,commandId:'new-thread',values:{cwd:path.join(cwd,'missing')},confirmed:true,requestId:crypto.randomUUID()}),/目录/);
    await f.controller.dispatch('command',{id:chat.threadId,commandId:'new-thread',values:{cwd},confirmed:true,requestId:crypto.randomUUID()});await f.bridgeRuntime.waitForIdle();assert.equal(f.events[0].text,'/new '+cwd);assert.equal(f.events[0].externalScopeId,'test-owner');assert.equal(f.deliveries.length,0);
  }finally{f.cleanup();}
});

test('original thread browser results become structured selectable cards rather than copied indexes',async()=>{
  const f=fixture();try{
    f.options.runtime.services.bridgeCoordinator.getThreadBrowserState=()=>({items:[{threadId:'stable-thread',title:'Existing thread',preview:'History preview'}]});
    const chat=f.controller.state()[0],requestId=crypto.randomUUID();await f.controller.dispatch('command',{id:chat.threadId,commandId:'thread-list',values:{},requestId});await f.bridgeRuntime.waitForIdle();const job:any=await f.controller.dispatch('action-result',{requestId});assert.equal(job.choices[0].target,'stable-thread');assert.equal(job.choices[0].kind,'thread');assert.equal(job.choices[0].title,'Existing thread');
  }finally{f.cleanup();}
});
