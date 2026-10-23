import { NextRequest, NextResponse } from 'next/server';
import { getWebAuthConfig, isAuthenticatedCookie } from '@/lib/server/auth';
import { isSameOriginRequest } from '@/lib/request-origin';

function redirectTo(request: NextRequest, pathname: string, status = 307, search = '') {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const location = new URL(`${normalizedPath}${search}`, request.url);
  return NextResponse.redirect(location, status);
}

function isPublicPath(pathname: string) {
  return pathname === '/login'
    || pathname === '/api/auth/pair'
    || pathname === '/downloads/Codex-Wechat-Android-0.1.0.apk'
    || pathname === '/downloads/Codex-Wechat-Android-0.2.0.apk'
    || pathname.startsWith('/api/auth/login')
    || pathname.startsWith('/_next')
    || pathname.startsWith('/icons/')
    || pathname.startsWith('/generated/')
    || pathname === '/favicon.ico';
}

function isApiPath(pathname: string) {
  return pathname.startsWith('/api/');
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get('origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin && !isSameOriginRequest(request)) {
    return NextResponse.json({ error: '请求来源不匹配' }, { status: 403 });
  }
  if (pathname === '/manifest.webmanifest') return NextResponse.next();
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const config = getWebAuthConfig();
  const sessionCookie = request.cookies.get(config.cookieName)?.value;
  const authenticated = await isAuthenticatedCookie(sessionCookie);

  if (authenticated) {
    return NextResponse.next();
  }

  if (isApiPath(pathname)) {
    return NextResponse.json(
      {
        error: config.enabled ? 'Unauthorized' : 'Web auth is not configured',
      },
      { status: 401 },
    );
  }

  if (!config.enabled) {
    return redirectTo(request, '/login', 307, '?error=config');
  }
  return redirectTo(request, '/login');
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
