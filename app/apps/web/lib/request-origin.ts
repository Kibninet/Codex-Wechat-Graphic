export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    // Next.js can normalize request.url to localhost even for a LAN hostname.
    const host = request.headers.get('host') ?? target.host;
    return source.host === host && source.protocol === target.protocol;
  } catch { return false; }
}
