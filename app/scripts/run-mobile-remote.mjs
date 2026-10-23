import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {startMobileRemoteGateway} from './mobile-remote-gateway.mjs';

const args=Object.fromEntries(Array.from({length:Math.floor((process.argv.length-2)/2)},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
if(!args['--cloudflared'] || !args['--state-dir']) throw new Error('Use --cloudflared <official executable> --state-dir <private bridge state>');
const state=path.resolve(args['--state-dir']);const file=path.join(state,'mobile','remote-endpoint.json');
const gateway=await startMobileRemoteGateway();
const child=spawn(path.resolve(args['--cloudflared']),['tunnel','--no-autoupdate','--protocol','http2','--url','http://127.0.0.1:'+gateway.port],{stdio:['ignore','pipe','pipe'],env:process.env});
let current='',stopping=false;
for(const stream of [child.stdout,child.stderr]){let buffer='';stream.setEncoding('utf8');stream.on('data',chunk=>{process.stdout.write(chunk);buffer=(buffer+chunk).slice(-8192);const match=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match && match[0]!==current){current=match[0];gateway.setPublicOrigin(current);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({publicUrl:current,pid:process.pid,startedAt:Date.now(),temporary:true,gatewayPort:gateway.port}),{mode:0o600});console.log('Mobile pairing is available from the local /phone page.');}});}
function cleanupFile(){try{if(JSON.parse(fs.readFileSync(file,'utf8')).pid===process.pid)fs.unlinkSync(file);}catch{}}
async function stop(){if(stopping)return;stopping=true;cleanupFile();child.kill();await gateway.close();}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
child.on('error',async e=>{console.error(e.message);await stop();process.exitCode=1;});
child.on('exit',async code=>{cleanupFile();await gateway.close();process.exitCode=code||0;});
