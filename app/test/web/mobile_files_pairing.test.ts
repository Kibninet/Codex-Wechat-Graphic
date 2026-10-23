import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import test from 'node:test';
// Web modules use the separate Next.js bundler tsconfig; load them at runtime here.

test('mobile uploads preserve .bak names, reject truncation and limits; pairing is one-use',async()=>{
  const state=fs.mkdtempSync(path.join(os.tmpdir(),'cw-phone-test-'));
  const previous=process.env.CODEXBRIDGE_WEB_STATE_DIR;
  process.env.CODEXBRIDGE_WEB_STATE_DIR=state;
  try{
    const {receiveMobileFile,resolveMobileFiles,MAX_MOBILE_FILE_BYTES}=await import(String('../../apps/web/server/mobile-files.js'));
    const payload=new Uint8Array(1024*1024).fill(7);
    const info=await receiveMobileFile(new Request('http://localhost/api/mobile/files?name=notes.bak',{method:'POST',headers:{'content-length':String(payload.length),'content-type':'application/octet-stream'},body:payload}));
    assert.equal(info.size,payload.length);assert.equal(info.name,'notes.bak');
    const files=resolveMobileFiles([info.id]);assert.equal(files[0].fileName,'notes.bak');assert.equal(fs.readFileSync(files[0].localPath).length,payload.length);
    await assert.rejects(receiveMobileFile(new Request('http://localhost/api/mobile/files',{method:'POST',headers:{'content-length':'10'},body:'abc'})),/未完整/);
    await assert.rejects(receiveMobileFile(new Request('http://localhost/api/mobile/files',{method:'POST',headers:{'content-length':String(MAX_MOBILE_FILE_BYTES+1)},body:'abc'})),/超过/);
    assert.throws(()=>resolveMobileFiles(['../auth.json']),/编号/);
    const {createMobilePairing,consumeMobilePairing}=await import(String('../../apps/web/server/mobile-pairing.js'));
    const pair=createMobilePairing();assert.ok(pair.expiresAt>Date.now());
    const root=path.join(state,'mobile/pairing');const ticket=fs.readdirSync(root).find(n=>n.endsWith('.json'))!;
    assert.ok(ticket);assert.equal(consumeMobilePairing('invalid'),false);
    // Isolate the code from private fixture links; no live identity or credential is used.
    if(pair.links.length){const code=new URL(pair.links[0]).searchParams.get('code');assert.equal(consumeMobilePairing(code),true);assert.equal(consumeMobilePairing(code),false);}
    const code=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(code).digest('hex');
    fs.writeFileSync(path.join(root,hash+'.json'),JSON.stringify({expiresAt:0}));assert.equal(consumeMobilePairing(code),false);
  }finally{
    if(previous===undefined)delete process.env.CODEXBRIDGE_WEB_STATE_DIR;else process.env.CODEXBRIDGE_WEB_STATE_DIR=previous;
    assert.equal(path.dirname(path.resolve(state)),path.resolve(os.tmpdir()));assert.ok(path.basename(state).startsWith('cw-phone-test-'));fs.rmSync(state,{recursive:true,force:true});
  }
});

test('phone pairing excludes WSL and virtual adapters and prefers a configured HTTPS endpoint',async()=>{
  const {mobilePairingCandidates}=await import(String('../../apps/web/server/mobile-pairing.js'));
  const iface=(address:string)=>[{address,family:'IPv4',internal:false}];
  const networks={'vEthernet (WSL (Hyper-V firewall))':iface('172.20.176.1'),WLAN:iface('192.168.5.20'),Docker:iface('172.17.0.1'),Ethernet:iface('169.254.1.1')};
  const local=mobilePairingCandidates(networks);assert.equal(local.length,1);assert.equal(local[0].server,'http://192.168.5.20:58888');assert.equal(local[0].mode,'lan');
  const remote=mobilePairingCandidates(networks,'https://mobile.example.test');assert.equal(remote.length,1);assert.equal(remote[0].mode,'remote');assert.equal(remote[0].server,'https://mobile.example.test');
  assert.deepEqual(mobilePairingCandidates({'vEthernet (WSL)':iface('172.20.176.1')}),[]);
  assert.throws(()=>mobilePairingCandidates(networks,'http://public.example.test'),/HTTPS/);
  assert.throws(()=>mobilePairingCandidates(networks,'https://user:password@example.test'),/HTTPS/);
});

