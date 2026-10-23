import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptAesEcb } from '../../../../src/platforms/weixin/official/cdn/aes_ecb.js';
import { downloadAndDecryptBuffer, downloadPlainCdnBuffer, WEIXIN_MEDIA_MAX_BYTES } from '../../../../src/platforms/weixin/official/cdn/pic_decrypt.js';
import { downloadMediaFromItem } from '../../../../src/platforms/weixin/official/media/media_download.js';

const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const file = (len?: string) => ({ type: 4, file_item: { file_name: 'backup.bak', len,
  media: { full_url: 'https://cdn.example/file?secret=not-for-errors', aes_key: key.toString('base64') } } });
const fetcher = (callback: (...args: any[]) => any) => callback as typeof fetch;

test('receives a 39.9 MiB encrypted BAK, keeps its name and verifies every byte', async () => {
  const plaintext = Buffer.alloc(Math.floor(39.9 * 1024 * 1024), 0x5a);
  const encrypted = encryptAesEcb(plaintext, key);
  let saved = false;
  const result = await downloadMediaFromItem(file(String(plaintext.length)), {
    cdnBaseUrl: 'https://cdn.example', label: 'test',
    downloadOptions: { fetchImpl: fetcher(async () => new Response(encrypted, { headers: { 'content-length': String(encrypted.length) } })) },
    saveMedia: async (buffer, mime, _dir, limit, name) => {
      assert.deepEqual(buffer, plaintext);
      assert.equal(mime, 'application/octet-stream');
      assert.equal(name, 'backup.bak');
      assert.equal(limit, WEIXIN_MEDIA_MAX_BYTES);
      saved = true;
      return { path: '/saved/backup.bak' };
    },
  });
  assert.equal(saved, true);
  assert.equal(result.decryptedFilePath, '/saved/backup.bak');
});

test('rejects oversized declared files before fetching or saving', async () => {
  await assert.rejects(downloadMediaFromItem(file(String(WEIXIN_MEDIA_MAX_BYTES + 1)), {
    cdnBaseUrl: '', label: 'test',
    downloadOptions: { fetchImpl: fetcher(() => assert.fail('must not fetch')) },
    saveMedia: async () => assert.fail('must not save'),
  }), /weixin_media:too_large/);
});

test('missing media metadata is an explicit failure rather than an empty message', async () => {
  for (const type of [2, 3, 4, 5]) {
    await assert.rejects(downloadMediaFromItem({ type }, {
      cdnBaseUrl: '', label: 'test', saveMedia: async () => assert.fail('must not save'),
    }), /weixin_media:unavailable/);
  }
});

test('a transient HTTP failure retries then returns the downloaded bytes', async () => {
  let attempts = 0;
  const buffer = await downloadPlainCdnBuffer('', '', '', 'https://cdn.example/file', {
    retryDelayMs: 0, fetchImpl: fetcher(async () => ++attempts === 1 ? new Response(null, { status: 503 }) : new Response('ok')),
  });
  assert.equal(attempts, 2);
  assert.equal(buffer.toString(), 'ok');
});

test('permanent HTTP failure is not retried and never exposes signed URLs or response bodies', async () => {
  let attempts = 0;
  await assert.rejects(downloadPlainCdnBuffer('', '', '', 'https://cdn.example/file?token=SECRET', {
    fetchImpl: fetcher(async () => { attempts++; return new Response('SECRET', { status: 403 }); }),
  }), (error: Error) => error.message === 'weixin_media:http');
  assert.equal(attempts, 1);
});

test('bounds both header-declared and chunked response sizes without saving partial bytes', async () => {
  for (const headers of [{ 'content-length': '200' }, {}]) {
    await assert.rejects(downloadPlainCdnBuffer('', '', '', 'https://cdn.example/file', {
      maxBytes: 16, fetchImpl: fetcher(async () => new Response(Buffer.alloc(200), { headers })),
    }), /weixin_media:too_large/);
  }
});

test('stalled headers and stalled bodies time out and abort rather than hanging forever', async () => {
  for (const stallBody of [false, true]) {
    let signal: AbortSignal | undefined;
    await assert.rejects(downloadPlainCdnBuffer('', '', '', 'https://cdn.example/file', {
      attempts: 1, timeoutMs: 100, idleTimeoutMs: 10,
      fetchImpl: fetcher(async (_url, options) => {
        signal = options.signal;
        return stallBody ? new Response(new ReadableStream({ pull: () => new Promise(() => {}) })) : new Promise(() => {});
      }),
    }), /weixin_media:timeout/);
    assert.equal(signal?.aborted, true);
  }
});

test('truncated downloads retry and remain an explicit failure after exhaustion', async () => {
  let attempts = 0;
  await assert.rejects(downloadPlainCdnBuffer('', '', '', 'https://cdn.example/file', {
    retryDelayMs: 0, fetchImpl: fetcher(async () => { attempts++; return new Response('short', { headers: { 'content-length': '10' } }); }),
  }), /weixin_media:incomplete/);
  assert.equal(attempts, 3);
});

test('invalid encryption and mismatched declared plaintext length cannot produce saved attachments', async () => {
  await assert.rejects(downloadAndDecryptBuffer('', key.toString('base64'), '', '', 'https://cdn.example/file', {
    fetchImpl: fetcher(async () => new Response('not AES ciphertext')),
  }), /weixin_media:decrypt_failed/);
  await assert.rejects(downloadMediaFromItem(file('999'), {
    cdnBaseUrl: '', label: 'test', saveMedia: async () => assert.fail('must not save'),
    downloadOptions: { fetchImpl: fetcher(async () => new Response(encryptAesEcb(Buffer.from('short'), key))) },
  }), /weixin_media:incomplete/);
});
