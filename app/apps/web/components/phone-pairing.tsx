'use client';
import { useState } from 'react';
type Entry={server:string;label:string;mode:string;link:string};
export function PhonePairing() {
  const [entries,setEntries]=useState<Entry[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function generate(){setBusy(true);setError('');try{const r=await fetch('/api/mobile/pairing',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const body=await r.json();if(!r.ok)throw new Error(body.error||'生成失败');setEntries(body.data.entries||body.data.links.map((link:string)=>({link,label:'电脑地址',mode:'lan',server:new URL(link).searchParams.get('server')})));}catch(e){setError(e instanceof Error?e.message:'生成失败');}finally{setBusy(false);}}
  return <main className="phone-pairing">
    <p className="control-eyebrow">CODEX-WECHAT · ANDROID</p><h2>给微信聊天加个手机管理面板。</h2>
    <p>App 管理正在使用的微信桥接：聊天切换、文件草稿、模型和任务都与微信共用，最终回复仍发送到微信。</p>
    <a className="auth-button" href="/downloads/Codex-Wechat-Android-0.2.0.apk" download>下载 Android APK</a>
    <h3>首次连接</h3><ol><li>把 APK 传到手机安装，打开 Codex-Wechat。</li><li>生成配对链接。使用 5G 时，选择标为“5G / 外网 · HTTPS”的入口。</li><li>在 App 粘贴链接并点击“连接微信桥接”。</li></ol>
    <button className="auth-button" disabled={busy} onClick={()=>void generate()}>{busy?'正在生成…':'生成 10 分钟有效的配对链接'}</button>
    {entries.map(entry=><div className="pairing-link" key={entry.link}><h3>{entry.label}</h3><p>{entry.server}</p><p className="small">{entry.mode==='remote'?'手机使用 5G 或 Wi-Fi 均可尝试连接。当前临时远程入口会在隧道停止后失效，重启后需要用新地址重新配对。':'仅限手机与电脑网络互通；5G 不能直接访问这个地址。'}</p><textarea aria-label={entry.label+'配对链接'} readOnly value={entry.link} rows={4}/><button onClick={()=>navigator.clipboard.writeText(entry.link).then(()=>setError('已复制配对链接')).catch(()=>setError('请手动选择上面的链接复制'))}>复制链接</button></div>)}
    {error?<p role="status">{error}</p>:null}
    <p className="small">配对链接只能使用一次，请勿发给他人。虚拟网卡地址已过滤。若只有“同一局域网”入口，说明远程入口尚未启动；该链接无法用于手机移动数据。</p>
    <p><a href="/mobile/index.html">在电脑预览手机管理界面</a> · <a href="/control">返回控制台</a></p>
  </main>;
}
