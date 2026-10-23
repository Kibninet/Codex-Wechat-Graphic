import { NextResponse } from 'next/server';
import { createAuthSessionToken, getWebAuthConfig } from '@/lib/server/auth';
import { consumeMobilePairing } from '@/server/mobile-pairing';
import { isSameOriginRequest } from '@/lib/request-origin';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '请求来源不匹配' }, { status: 403 });
  const cfg = getWebAuthConfig();
  if (!cfg.enabled || !cfg.username || !cfg.password) return NextResponse.json({ error: '电脑端尚未完成配置' }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!consumeMobilePairing(body?.code)) return NextResponse.json({ error: '配对链接已过期或已使用，请在电脑端重新生成' }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cfg.cookieName, await createAuthSessionToken(cfg.username, cfg.password), {
    httpOnly: true, sameSite: 'lax', secure: cfg.secureCookie, maxAge: cfg.maxAgeSeconds, path: '/',
  });
  return response;
}
