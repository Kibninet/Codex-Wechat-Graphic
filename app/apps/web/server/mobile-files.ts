import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getWebPaths } from '../lib/server/runtime';

export const MAX_MOBILE_FILE_BYTES = 100 * 1024 * 1024;
export function mobileDataDir() { return path.join(getWebPaths().stateDir, 'mobile'); }
const validId = (id: string) => /^[a-f0-9-]{36}$/i.test(id);
export async function receiveMobileFile(request: Request) {
  const size = Number(request.headers.get('content-length') || 0);
  if (size > MAX_MOBILE_FILE_BYTES) throw new Error('文件超过 100 MiB 限制');
  if (!request.body) throw new Error('未收到文件内容');
  const rawName = new URL(request.url).searchParams.get('name') || 'attachment';
  const name = rawName.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 180) || 'attachment';
  const id = crypto.randomUUID();
  const root = path.join(mobileDataDir(), 'uploads'); fs.mkdirSync(root, { recursive: true });
  const suffix = path.extname(name);
  const diskName = id + (/^\.[a-z0-9]{1,16}$/i.test(suffix) ? suffix : '.bin');
  const filePath = path.join(root, diskName); let received = 0;
  const limit = new Transform({ transform(chunk, _encoding, done) {
    received += chunk.length;
    done(received > MAX_MOBILE_FILE_BYTES ? new Error('文件超过 100 MiB 限制') : null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(request.body as any), limit, fs.createWriteStream(filePath, { flags: 'wx' }), { signal: request.signal });
    if (size > 0 && received !== size) throw new Error('文件未完整传输，请重新选择');
    const info = { id, name, diskName, size: received, mimeType: request.headers.get('content-type') || 'application/octet-stream', createdAt: Date.now() };
    fs.writeFileSync(path.join(root, id + '.json'), JSON.stringify(info));
    return info;
  } catch (e) {
    // Remove only the exact random file created by this request.
    fs.rmSync(filePath, { force: true }); throw e;
  }
}
export function resolveMobileFiles(ids: unknown) {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 20) throw new Error('一次最多发送 20 个附件');
  return ids.map(id => {
    if (typeof id !== 'string' || !validId(id)) throw new Error('附件编号无效');
    const root = path.join(mobileDataDir(), 'uploads');
    const info = JSON.parse(fs.readFileSync(path.join(root, id + '.json'), 'utf8'));
    if (typeof info.diskName !== 'string' || !new RegExp('^' + id + '\\.[a-z0-9]{1,16}$','i').test(info.diskName)) throw new Error('附件存储信息无效');
    const localPath = path.join(root, info.diskName);
    if (!fs.existsSync(localPath) || fs.statSync(localPath).size !== info.size) throw new Error('附件已失效，请重新选择');
    return { kind: String(info.mimeType).startsWith('image/') ? 'image' : 'file', localPath,
      fileName: info.name, mimeType: info.mimeType };
  });
}
