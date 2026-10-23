import http from 'node:http';
import { Transform } from 'node:stream';

const ID = '[a-f0-9]{32}';
/** Only the APK API is forwarded. Desktop pages, login and service control stay local. */
export function mobileRemoteRoute(method, pathname) {
  if (method === 'GET') return pathname === '/health' || new RegExp(`^/api/mobile/(threads|archived|commands|action/[a-zA-Z0-9-]{16,80}|thread/${ID}|models(?:/${ID})?|run/${ID})$`).test(pathname);
  if (method !== 'POST') return false;
  return pathname === '/api/auth/pair' || new RegExp(`^/api/mobile/(threads|files|thread/${ID}/(?:select|mode|send|settings|rename|archive|restore|draft-discard|command)|run/${ID}/(?:stop|approve))$`).test(pathname);
}

export async function startMobileRemoteGateway({ upstream = 'http://127.0.0.1:58888', publicOrigin = null, port = 0 } = {}) {
  const target = new URL(upstream);
  if (target.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('Gateway upstream must be local HTTP');
  let origin = publicOrigin ? new URL(publicOrigin).origin : null;
  const pairAttempts = new Map();
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    const fail = (status, error) => { if (!response.headersSent) { response.writeHead(status,{'content-type':'application/json; charset=utf-8'}); response.end(JSON.stringify({error})); } };
    let url;
    try { url = new URL(request.url, 'http://gateway.local'); } catch { fail(400,'请求地址无效'); return; }
    if (!mobileRemoteRoute(request.method,url.pathname)) { fail(404,'未开放这个接口'); return; }
    if (request.method === 'GET' && url.pathname === '/health') { response.writeHead(origin ? 200 : 503,{'content-type':'application/json'}); response.end(JSON.stringify({ready:Boolean(origin)})); return; }
    if (!origin) { fail(503,'远程入口尚未就绪'); return; }
    // Android sends Origin explicitly. Reject CSRF before rewriting the local origin.
    if (request.headers.origin !== origin) { fail(403,'请求来源不匹配'); return; }
    if (url.pathname === '/api/auth/pair') {
      const now = Date.now();
      const ip = String(request.headers['cf-connecting-ip'] || request.socket.remoteAddress || '').slice(0,100);
      for (const [key,value] of pairAttempts) if (now-value.start>60000) pairAttempts.delete(key);
      if (pairAttempts.size > 4096) { fail(429,'请求过于频繁'); return; }
      const attempt=pairAttempts.get(ip) || {start:now,count:0};pairAttempts.set(ip,attempt);
      if (++attempt.count > 12) { fail(429,'配对请求过于频繁，请稍后重试'); return; }
    }
    const max = url.pathname === '/api/mobile/files' ? 100*1024*1024 : url.pathname === '/api/auth/pair' ? 8192 : 512*1024;
    const length = request.headers['content-length'];
    if (length && (!/^\d+$/.test(length) || Number(length)>max)) { fail(413,'请求超过大小限制'); return; }
    const headers = { host:target.host, origin:target.origin, accept:'application/json' };
    for (const name of ['cookie','content-type','content-length']) if(request.headers[name]) headers[name]=request.headers[name];
    let received=0;
    const limiter=new Transform({transform(chunk,_enc,done){received+=chunk.length;done(received>max ? new Error('too large') : null,chunk);}});
    const forward = http.request(new URL(url.pathname+url.search,target), {method:request.method,headers}, incoming => {
      if(response.headersSent){incoming.resume();return;}
      const outgoing = {'content-type':incoming.headers['content-type'] || 'application/json','cache-control':'no-store'};
      if(incoming.headers['set-cookie'] && url.pathname === '/api/auth/pair') outgoing['set-cookie']=incoming.headers['set-cookie'].map(c=>/;\s*Secure(?:;|$)/i.test(c)?c:c+'; Secure');
      response.writeHead(incoming.statusCode || 502,outgoing);
      incoming.on('error',()=>response.destroy());incoming.pipe(response);
    });
    forward.setTimeout(url.pathname === '/api/mobile/files' ? 310000 : 45000,()=>forward.destroy(new Error('timeout')));
    forward.on('error',()=>fail(502,'电脑管理服务暂时不可用'));
    limiter.on('error',()=>{request.unpipe(limiter);request.resume();fail(413,'请求超过大小限制');forward.destroy();});
    request.on('aborted',()=>forward.destroy());
    response.on('close',()=>{if(!response.writableEnded)forward.destroy();});
    request.pipe(limiter).pipe(forward);
  });
  server.requestTimeout=330000;server.headersTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return { port:server.address().port, setPublicOrigin(value){const u=new URL(value);if(u.protocol!=='https:')throw new Error('Remote URL must use HTTPS');origin=u.origin;}, close:()=>new Promise(resolve=>server.close(resolve)) };
}
