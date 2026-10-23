import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mobileRemoteRoute,startMobileRemoteGateway} from '../../scripts/mobile-remote-gateway.mjs';

test('remote gateway exposes only APK operations, validates origin and preserves auth',async()=>{
  const id='a'.repeat(32);const seen:any[]=[];
  const upstream=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;seen.push({url:req.url,method:req.method,origin:req.headers.origin,cookie:req.headers.cookie,forwarded:req.headers['x-forwarded-host'],body});res.setHeader('content-type','application/json');if(req.url==='/api/auth/pair')res.setHeader('set-cookie','session=test; HttpOnly; Path=/');res.end(JSON.stringify({data:'mock'}));});
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const upstreamBase='http://127.0.0.1:'+(upstream.address() as any).port;
  const gateway=await startMobileRemoteGateway({upstream:upstreamBase,publicOrigin:'https://phone.example.test'});
  const base='http://127.0.0.1:'+gateway.port;
  try{
    assert.equal(mobileRemoteRoute('POST','/api/mobile/thread/'+id+'/send'),true);
    assert.equal((await fetch(base+'/health')).status,200);
    for(const route of ['/phone','/api/bridge/control','/api/auth/login','/api/mobile/pairing','/api/codex-threads'])assert.equal((await fetch(base+route,{method:'POST',headers:{origin:'https://phone.example.test'}})).status,404);
    assert.equal((await fetch(base+'/api/mobile/threads')).status,403);
    assert.equal((await fetch(base+'/api/mobile/threads',{headers:{origin:'https://evil.example.test'}})).status,403);
    assert.equal(seen.length,0);
    const r=await fetch(base+'/api/mobile/threads',{headers:{origin:'https://phone.example.test',cookie:'session=local-test','x-forwarded-host':'evil.example.test'}});assert.equal(r.status,200);assert.equal(seen[0].cookie,'session=local-test');assert.equal(seen[0].origin,upstreamBase);assert.equal(seen[0].forwarded,undefined);
    const paired=await fetch(base+'/api/auth/pair',{method:'POST',headers:{origin:'https://phone.example.test','content-type':'application/json'},body:JSON.stringify({code:'fixture'})});assert.equal(paired.status,200);assert.match(paired.headers.get('set-cookie')||'',/; Secure/);
    const oversized=await fetch(base+'/api/auth/pair',{method:'POST',headers:{origin:'https://phone.example.test'},body:'x'.repeat(9000)});assert.equal(oversized.status,413);assert.equal(seen.length,2);
  }finally{await gateway.close();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});
