import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getWebAuthConfig, isAuthenticatedCookie } from '@/lib/server/auth';
import { controlBridge } from '@/server/bridge-control';
import { isSameOriginRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authenticated() {
  const config = getWebAuthConfig();
  return isAuthenticatedCookie((await cookies()).get(config.cookieName)?.value);
}

export async function GET() {
  if (!await authenticated()) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try { return NextResponse.json(await controlBridge('status'), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: '暂时无法读取后台状态，请稍后刷新' }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!await authenticated()) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: '请求来源不匹配' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: '需要 JSON 请求' }, { status: 415 });
  }
  const body = await request.json().catch(() => null);
  if (body?.action !== 'start' && body?.action !== 'stop') {
    return NextResponse.json({ error: '只能启动或停止桥接' }, { status: 400 });
  }
  try { return NextResponse.json(await controlBridge(body.action), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: '操作未能完成，请刷新状态后再试' }, { status: 503 }); }
}
