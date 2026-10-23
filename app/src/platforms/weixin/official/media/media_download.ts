import { downloadAndDecryptBuffer, downloadPlainCdnBuffer, WEIXIN_MEDIA_MAX_BYTES, WeixinMediaError, type MediaDownloadOptions } from '../cdn/pic_decrypt.js';
import { getMimeFromFilename } from './mime.js';
import { silkToWav } from './silk_transcode.js';
import type { WeixinMessage } from '../types.js';
import { MessageItemType } from '../types.js';

export type WeixinInboundMediaOpts = {
  decryptedPicPath?: string;
  decryptedVoicePath?: string;
  voiceMediaType?: string;
  decryptedFilePath?: string;
  fileMediaType?: string;
  decryptedVideoPath?: string;
};

type SaveMediaFn = (
  buffer: Buffer,
  contentType?: string,
  subdir?: string,
  maxBytes?: number,
  originalFilename?: string,
) => Promise<{ path: string }>;

export async function downloadMediaFromItem(
  item: WeixinMessage['item_list'] extends (infer T)[] | undefined ? T : never,
  deps: {
    cdnBaseUrl: string;
    saveMedia: SaveMediaFn;
    label: string;
    downloadOptions?: MediaDownloadOptions;
  },
): Promise<WeixinInboundMediaOpts> {
  const result: WeixinInboundMediaOpts = {};

  if (item.type === MessageItemType.IMAGE) {
    const img = item.image_item;
    if (!img?.media?.encrypt_query_param && !img?.media?.full_url) {
      throw new WeixinMediaError('unavailable');
    }
    const aesKeyBase64 = img.aeskey
      ? Buffer.from(img.aeskey, 'hex').toString('base64')
      : img.media?.aes_key;
    const buf = aesKeyBase64
      ? await downloadAndDecryptBuffer(
        img.media?.encrypt_query_param ?? '',
        aesKeyBase64,
        deps.cdnBaseUrl,
        `${deps.label} image`,
        img.media?.full_url,
        deps.downloadOptions,
      )
      : await downloadPlainCdnBuffer(
        img.media?.encrypt_query_param ?? '',
        deps.cdnBaseUrl,
        `${deps.label} image-plain`,
        img.media?.full_url,
        deps.downloadOptions,
      );
    const saved = await deps.saveMedia(buf, undefined, 'inbound', WEIXIN_MEDIA_MAX_BYTES);
    result.decryptedPicPath = saved.path;
    return result;
  }

  if (item.type === MessageItemType.VOICE) {
    const voice = item.voice_item;
    if ((!voice?.media?.encrypt_query_param && !voice?.media?.full_url) || !voice?.media?.aes_key) {
      throw new WeixinMediaError('unavailable');
    }
    const silkBuf = await downloadAndDecryptBuffer(
      voice.media.encrypt_query_param ?? '',
      voice.media.aes_key,
      deps.cdnBaseUrl,
      `${deps.label} voice`,
      voice.media.full_url,
      deps.downloadOptions,
    );
    const wavBuf = await silkToWav(silkBuf);
    if (wavBuf) {
      const saved = await deps.saveMedia(wavBuf, 'audio/wav', 'inbound', WEIXIN_MEDIA_MAX_BYTES);
      result.decryptedVoicePath = saved.path;
      result.voiceMediaType = 'audio/wav';
      return result;
    }
    const saved = await deps.saveMedia(silkBuf, 'audio/silk', 'inbound', WEIXIN_MEDIA_MAX_BYTES);
    result.decryptedVoicePath = saved.path;
    result.voiceMediaType = 'audio/silk';
    return result;
  }

  if (item.type === MessageItemType.FILE) {
    const fileItem = item.file_item;
    if ((!fileItem?.media?.encrypt_query_param && !fileItem?.media?.full_url) || !fileItem?.media?.aes_key) {
      throw new WeixinMediaError('unavailable');
    }
    const declaredSize = fileItem.len && /^\d+$/.test(fileItem.len) ? Number(fileItem.len) : null;
    if (declaredSize !== null && declaredSize > WEIXIN_MEDIA_MAX_BYTES) throw new WeixinMediaError('too_large');
    const buf = await downloadAndDecryptBuffer(
      fileItem.media.encrypt_query_param ?? '',
      fileItem.media.aes_key,
      deps.cdnBaseUrl,
      `${deps.label} file`,
      fileItem.media.full_url,
      deps.downloadOptions,
    );
    if (declaredSize !== null && declaredSize !== buf.length) throw new WeixinMediaError('incomplete');
    const mime = getMimeFromFilename(fileItem.file_name ?? 'file.bin');
    const saved = await deps.saveMedia(
      buf,
      mime,
      'inbound',
      WEIXIN_MEDIA_MAX_BYTES,
      fileItem.file_name ?? undefined,
    );
    result.decryptedFilePath = saved.path;
    result.fileMediaType = mime;
    return result;
  }

  if (item.type === MessageItemType.VIDEO) {
    const videoItem = item.video_item;
    if ((!videoItem?.media?.encrypt_query_param && !videoItem?.media?.full_url) || !videoItem?.media?.aes_key) {
      throw new WeixinMediaError('unavailable');
    }
    const buf = await downloadAndDecryptBuffer(
      videoItem.media.encrypt_query_param ?? '',
      videoItem.media.aes_key,
      deps.cdnBaseUrl,
      `${deps.label} video`,
      videoItem.media.full_url,
      deps.downloadOptions,
    );
    const saved = await deps.saveMedia(buf, 'video/mp4', 'inbound', WEIXIN_MEDIA_MAX_BYTES);
    result.decryptedVideoPath = saved.path;
    return result;
  }

  return result;
}
