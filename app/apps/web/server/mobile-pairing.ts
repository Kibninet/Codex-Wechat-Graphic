import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { mobileDataDir } from './mobile-files';

const codeHash = (code: string) => crypto.createHash('sha256').update(code).digest('hex');
export function mobilePairingCandidates(interfaces = os.networkInterfaces(), remoteBase?: string) {
  if (remoteBase) {
    const url = new URL(remoteBase);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('远程入口必须是有效的 HTTPS 地址');
    return [{server:url.origin,label:'5G / 外网 · HTTPS',mode:'remote'}];
  }
  const virtual = /vethernet|wsl|hyper.?v|docker|vmware|virtualbox|vbox|loopback|tailscale|wireguard|zerotier|\bvpn\b|\btap\b|\btun\b|^utun|^bridge|^virbr|^veth/i;
  const found = new Map<string,{server:string;label:string;mode:string}>();
  const names = Object.keys(interfaces).sort((a,b)=>Number(!/wi-?fi|wlan/i.test(a))-Number(!/wi-?fi|wlan/i.test(b)));
  for (const name of names) {
    if(virtual.test(name))continue;
    for(const item of interfaces[name] || []) {
      if(item.family!=='IPv4' || item.internal || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address))continue;
      found.set(item.address,{server:`http://${item.address}:58888`,label:`同一局域网 · ${name}`,mode:'lan'});
    }
  }
  return [...found.values()];
}
function runningRemoteBase() {
  if(process.env.CODEXBRIDGE_MOBILE_PUBLIC_URL)return process.env.CODEXBRIDGE_MOBILE_PUBLIC_URL;
  try {
    const endpoint=JSON.parse(fs.readFileSync(path.join(mobileDataDir(),'remote-endpoint.json'),'utf8'));
    if(!Number.isInteger(endpoint.pid) || endpoint.pid<=0)return undefined;
    process.kill(endpoint.pid,0);
    return String(endpoint.publicUrl);
  }catch{return undefined;}
}
export function createMobilePairing() {
  const targets=mobilePairingCandidates(os.networkInterfaces(),runningRemoteBase());
  if(!targets.length)throw new Error('没有可用的电脑地址，请连接网络或启动远程管理入口');
  const code = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + 10 * 60_000;
  const root = path.join(mobileDataDir(), 'pairing'); fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, codeHash(code) + '.json'), JSON.stringify({ expiresAt }), { flag: 'wx' });
  const entries=targets.map(target=>({...target,link:`codexwechat://pair?server=${encodeURIComponent(target.server)}&code=${code}`}));
  return { expiresAt, links: entries.map(t=>t.link), entries };
}
export function consumeMobilePairing(code: unknown) {
  if (typeof code !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(code)) return false;
  const file = path.join(mobileDataDir(), 'pairing', codeHash(code) + '.json');
  try {
    const ticket = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (ticket.expiresAt < Date.now()) return false;
    fs.renameSync(file, file + '.used');
    return true;
  } catch { return false; }
}
