import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getWebAuthConfig, isAuthenticatedCookie } from '@/lib/server/auth';
import { isSameOriginRequest } from '@/lib/request-origin';
import { mobileTasks } from '@/server/mobile-tasks';
import { receiveMobileFile } from '@/server/mobile-files';
import { createMobilePairing } from '@/server/mobile-pairing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const cfg = getWebAuthConfig();
  if (!await isAuthenticatedCookie((await cookies()).get(cfg.cookieName)?.value)) return NextResponse.json({ error: '请先配对登录' }, { status: 401 });
  if (request.method !== 'GET' && !isSameOriginRequest(request)) return NextResponse.json({ error: '请求来源不匹配' }, { status: 403 });
  const parts = (await context.params).path;
  const [kind, id, action] = parts;
  try {
    let data: unknown;
    if (request.method === 'GET') {
      if (kind === 'threads' && !id) data = await mobileTasks.threads();
      else if (kind === 'archived' && !id) data = await mobileTasks.archived();
      else if (kind === 'commands' && !id) data = await mobileTasks.commands();
      else if (kind === 'action' && id && !action) data = await mobileTasks.actionResult(id);
      else if (kind === 'thread' && id && !action) data = await mobileTasks.messages(id);
      else if (kind === 'models' && !action) data = await mobileTasks.models(id);
      else if (kind === 'run' && id && !action) data = await mobileTasks.snapshot(id);
      else return NextResponse.json({ error: '未找到这个接口' }, { status: 404 });
    } else {
      if (kind === 'files' && !id) data = await receiveMobileFile(request);
      else {
        const body = await request.json();
        if (kind === 'pairing' && !id) data = createMobilePairing();
        else if (kind === 'threads' && !id) data = await mobileTasks.create(typeof body.title === 'string' ? body.title.slice(0,100) : undefined);
        else if (kind === 'thread' && id && action === 'select') data = await mobileTasks.select(id);
        else if (kind === 'thread' && id && action === 'mode') data = await mobileTasks.mode(id,body.mode);
        else if (kind === 'thread' && id && ['rename','archive','restore','draft-discard','command'].includes(action)) data = await mobileTasks.manage(id,action,body);
        else if (kind === 'thread' && id && action === 'send') data = await mobileTasks.submit(id, String(body.text || ''), body.fileIds, String(body.requestId || ''));
        else if (kind === 'thread' && id && action === 'settings') data = await mobileTasks.settings(id, body);
        else if (kind === 'run' && id && action === 'stop') data = await mobileTasks.stop(id);
        else if (kind === 'run' && id && action === 'approve' && ['accept','decline'].includes(body.decision)) data = await mobileTasks.approve(id, String(body.requestId), body.decision,body.remember===true);
        else return NextResponse.json({ error: '未找到这个操作' }, { status: 404 });
      }
    }
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '操作失败' }, { status: 400 }); }
}
export const GET = handle;
export const POST = handle;
