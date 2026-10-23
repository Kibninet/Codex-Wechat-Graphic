import type { InboundTextEvent } from '../types/platform.js';

export function inboundAttachmentFailure(event: InboundTextEvent, locale = 'zh-CN'): string | null {
  const metadata = event.metadata?.weixin as { attachmentErrors?: unknown } | undefined;
  const errors = metadata?.attachmentErrors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const english = locale.startsWith('en');
  const reasons: Record<string, [string, string]> = {
    too_large: ['文件超过单个 100 MiB 的接收上限，请拆分后重发。', 'The file exceeds the 100 MiB limit. Split it and resend.'],
    timeout: ['附件下载超时，自动重试后仍未成功。请检查网络后重发。', 'The attachment download timed out after retries. Check the connection and resend.'],
    network: ['附件下载网络异常，自动重试后仍未成功，请重发。', 'The attachment download failed after retries. Please resend.'],
    http: ['微信文件下载服务返回错误，请重新发送原文件。', 'The WeChat download service returned an error. Resend the original file.'],
    unavailable: ['微信没有提供可下载的附件信息，请重新发送原文件，或将文件压成 ZIP 后发送。', 'WeChat did not provide downloadable attachment information. Resend the original file or a ZIP.'],
    decrypt_failed: ['附件无法解密，请重新发送原文件。', 'The attachment could not be decrypted. Resend the original file.'],
    incomplete: ['附件数据不完整，请重新发送原文件。', 'The attachment data is incomplete. Resend the original file.'],
  };
  const details = [...new Set(errors.map((error) => {
    const code = /^weixin_media:([a-z_]+)$/.exec(String(error))?.[1] ?? '';
    return reasons[code]?.[english ? 1 : 0] ?? (english
      ? 'The attachment could not be saved. Check the network and free disk space, then resend.'
      : '附件接收或保存失败，请检查网络和电脑磁盘空间后重发。');
  }))];
  return [english ? 'Attachment reception failed. This message was not submitted to the model.'
    : '附件接收失败，这条消息没有提交给模型。', ...details,
  event.attachments?.length ? (english ? 'Some attachments arrived, but the batch was not submitted to avoid processing incomplete input. Resend the whole batch.'
    : '部分附件已收到；为避免遗漏，本批次没有提交。请重新发送这一组文件和说明。') : ''].filter(Boolean).join('\n');
}
