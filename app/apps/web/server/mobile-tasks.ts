import fs from 'node:fs';
import path from 'node:path';
import { getWebPaths } from '../lib/server/runtime';
import { getWebCodexThreadRecentMessages, clearWebQueryCaches } from '../lib/server/queries';

/** Controls the original WeChat bridge. No independent model client lives here. */
async function weixinControl(action: string, input: any = {}) {
  let connection: {port:number;token:string};
  try { connection=JSON.parse(fs.readFileSync(path.join(getWebPaths().stateDir,'mobile','weixin-control.json'),'utf8')); }
  catch { throw new Error('微信桥接未启用手机管理，请先在电脑端启动桥接'); }
  if (!Number.isInteger(connection.port) || connection.port<1 || connection.port>65535) throw new Error('微信桥接连接信息无效');
  let response: Response;
  try { response=await fetch(`http://127.0.0.1:${connection.port}/`,{method:'POST',headers:{authorization:'Bearer '+connection.token,'content-type':'application/json'},body:JSON.stringify({action,input}),signal:AbortSignal.timeout(30_000)}); }
  catch { throw new Error('暂时无法连接电脑上的微信桥接，请确认桥接正在运行'); }
  const result=await response.json();if(!response.ok)throw new Error(result.error||'微信管理操作失败');return result.data;
}
export const mobileTasks = {
  threads:()=>weixinControl('state'),
  archived:()=>weixinControl('archived'),
  commands:()=>weixinControl('commands'),
  actionResult:(requestId:string)=>weixinControl('action-result',{requestId}),
  manage:(id:string,action:string,input:any)=>weixinControl(action,{...input,id}),
  create:(title?: string)=>weixinControl('new',{name:title}),
  select:(id:string)=>weixinControl('select',{id}),
  models:(id?:string)=>weixinControl('models',{id}),
  async messages(id:string){const thread=(await weixinControl('state')).find((t:any)=>t.threadId===id);if(!thread)throw new Error('未找到微信聊天');clearWebQueryCaches();const history=thread.codexThreadId?await getWebCodexThreadRecentMessages(thread.codexThreadId,100):{items:[],hasMore:false};return {thread,...history,activeRunId:thread.activeRunId};},
  settings:(id:string,input:any)=>weixinControl('settings',{...input,id}),
  mode:(id:string,mode:string)=>weixinControl('mode',{id,mode}),
  submit:(id:string,text:string,fileIds:unknown,requestId:string)=>weixinControl('send',{id,text,fileIds,requestId}),
  snapshot:(id:string)=>weixinControl('run',{id}),
  stop:(id:string)=>weixinControl('stop',{id}),
  approve:(id:string,requestId:string,decision:string,remember=false)=>weixinControl('approve',{id,requestId,decision,remember}),
};
