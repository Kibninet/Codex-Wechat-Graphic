import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'Codex-Wechat', short_name: 'Codex-Wechat', description: '手机上的聊天与电脑控制台',
    start_url: '/control', scope: '/', display: 'standalone', background_color: '#f5f6f2', theme_color: '#243d32', lang: 'zh-CN',
    icons: [{ src: '/icons/codex-wechat.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
