'use client';

import { useEffect, useRef, useState } from 'react';

type Status = { configured: boolean; running: boolean | null; message: string };

export function BridgeControlPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');
  const requestPending = useRef(false);

  async function request(action: 'status' | 'start' | 'stop') {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true); setError('');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch('/api/bridge/control', {
        method: action === 'status' ? 'GET' : 'POST',
        ...(action === 'status' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }),
        cache: 'no-store', signal: controller.signal,
      });
      if (response.status === 401) { window.location.assign('/login'); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请求失败');
      setStatus(data); setUpdated(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      setError(e instanceof Error && e.name !== 'AbortError' ? e.message : '连接超时。操作状态未知，请刷新确认。');
    } finally { clearTimeout(timer); requestPending.current = false; setBusy(false); }
  }

  useEffect(() => { void request('status'); }, []);

  return (
    <main className="mobile-control">
      <div className="control-heading"><span className="control-eyebrow">CODEX-WECHAT</span><h2>电脑在做什么，一眼就知道。</h2><p>聊天和电脑控制，放在同一个地方。</p></div>
      <section className="control-hero" aria-labelledby="bridge-title">
        <div className="control-status-line"><span className={`control-dot ${status?.running === true && !error ? 'online' : ''}`} /><span>{error ? '状态待确认' : status?.running === true ? '后台运行中' : status?.running === false ? '后台已停止' : '正在检查后台'}</span><span className="control-tag">你的电脑</span></div>
        <h3 id="bridge-title">微信桥接</h3>
        <p>{status?.message || '正在读取这台电脑的服务状态…'}</p>
        <div className="control-buttons"><button type="button" className="control-primary" disabled={busy || !status?.configured || status.running === true} onClick={() => void request('start')}>{busy ? '处理中…' : '启动桥接'}</button><button type="button" className="control-secondary" disabled={busy || !status?.configured || status.running === false} onClick={() => void request('stop')}>停止桥接</button></div>
        <p className="control-footnote">停止桥接会中断微信侧正在执行的任务。此控制台仍可使用。</p>
      </section>
      <div className="control-shortcuts"><a href="/phone"><span aria-hidden="true">↗</span><h3>手机微信管理</h3><p>安装 APK，配对并管理原微信聊天</p></a><a href="/runtime"><span aria-hidden="true">⌁</span><h3>运行信息</h3><p>查看已配置的会话和提供方</p></a></div>
      <section className="control-info"><h3>这次别让“加载中”藏住状态。</h3><p>这里显示的是电脑桥接进程状态。微信登录、代理和模型连接仍是独立的环节；后台运行不代表模型已经连通。</p><button className="control-refresh" type="button" disabled={busy} onClick={() => void request('status')}>{busy ? '正在检查…' : '刷新状态'}{updated ? ` · ${updated}` : ''}</button></section>
      {error ? <p className="control-error" role="alert">{error}</p> : null}
    </main>
  );
}
