import { decryptAesEcb } from './aes_ecb.js';
import { buildCdnDownloadUrl, ENABLE_CDN_URL_FALLBACK } from './cdn_url.js';

export const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
export type MediaErrorCode = 'timeout' | 'network' | 'http' | 'too_large' | 'unavailable' | 'decrypt_failed' | 'incomplete' | 'save_failed';
export class WeixinMediaError extends Error {
  constructor(public code: MediaErrorCode, public retryable = false) {
    // Never retain signed download URLs, keys, or server response bodies.
    super(`weixin_media:${code}`);
  }
}

export interface MediaDownloadOptions {
  maxBytes?: number;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  attempts?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

async function fetchCdnBytes(url: string, options: MediaDownloadOptions): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? WEIXIN_MEDIA_MAX_BYTES;
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const bounded = async <T>(operation: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          operation,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new WeixinMediaError('timeout', true));
            }, Math.max(0, Math.min(options.idleTimeoutMs ?? 45_000, deadline - Date.now())));
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      if (Date.now() >= deadline) throw new WeixinMediaError('timeout', true);
      const response = await bounded((options.fetchImpl ?? fetch)(url, { signal: controller.signal }));
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new WeixinMediaError('http', response.status === 408 || response.status === 429 || response.status >= 500);
      }
      const lengthHeader = response.headers.get('content-length');
      const length = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
      const encoding = response.headers.get('content-encoding');
      const identity = !encoding || encoding === 'identity';
      if (identity && length !== null && length > maxBytes) {
        void response.body?.cancel().catch(() => {});
        throw new WeixinMediaError('too_large');
      }
      if (!response.body) throw new WeixinMediaError('incomplete', true);
      reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let size = 0;
      while (true) {
        const chunk = await bounded(reader.read());
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new WeixinMediaError('too_large');
        chunks.push(Buffer.from(chunk.value));
      }
      if (identity && length !== null && length !== size) throw new WeixinMediaError('incomplete', true);
      return Buffer.concat(chunks, size);
    } catch (error) {
      const failure = error instanceof WeixinMediaError ? error : new WeixinMediaError('network', true);
      controller.abort();
      void reader?.cancel().catch(() => {});
      if (!failure.retryable || attempt + 1 >= attempts || Date.now() >= deadline) throw failure;
      const delay = Math.min((options.retryDelayMs ?? 1000) * (attempt + 1), Math.max(0, deadline - Date.now()));
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      try { reader?.releaseLock(); } catch { /* A timed-out stream can still have a pending read. */ }
    }
  }
  throw new WeixinMediaError('network');
}

function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, 'base64');
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex');
  }
  throw new WeixinMediaError('decrypt_failed');
}

function downloadUrl(query: string, base: string, fullUrl?: string): string {
  if (fullUrl) return fullUrl;
  if (query && ENABLE_CDN_URL_FALLBACK) return buildCdnDownloadUrl(query, base);
  throw new WeixinMediaError('unavailable');
}

export async function downloadAndDecryptBuffer(
  encryptedQueryParam: string, aesKeyBase64: string, cdnBaseUrl: string,
  _label: string, fullUrl?: string, options: MediaDownloadOptions = {},
): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64);
  const maxBytes = options.maxBytes ?? WEIXIN_MEDIA_MAX_BYTES;
  const encrypted = await fetchCdnBytes(downloadUrl(encryptedQueryParam, cdnBaseUrl, fullUrl), {
    ...options, maxBytes: maxBytes + 16,
  });
  let plaintext: Buffer;
  try { plaintext = decryptAesEcb(encrypted, key); }
  catch { throw new WeixinMediaError('decrypt_failed'); }
  if (plaintext.length > maxBytes) throw new WeixinMediaError('too_large');
  return plaintext;
}

export async function downloadPlainCdnBuffer(
  encryptedQueryParam: string, cdnBaseUrl: string, _label: string,
  fullUrl?: string, options: MediaDownloadOptions = {},
): Promise<Buffer> {
  return fetchCdnBytes(downloadUrl(encryptedQueryParam, cdnBaseUrl, fullUrl), options);
}
