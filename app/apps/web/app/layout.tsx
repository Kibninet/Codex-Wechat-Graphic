import './globals.css';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { PrimaryNav } from '@/components/primary-nav';
import { LogoutForm } from '@/components/logout-form';
import { getWebAuthConfig, isAuthenticatedCookie } from '@/lib/server/auth';

export const metadata = {
  title: 'Codex-Wechat',
  description: '手机上的聊天与电脑控制台',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/codex-wechat.svg' },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#243d32' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const authConfig = getWebAuthConfig();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(authConfig.cookieName)?.value;
  const authenticated = await isAuthenticatedCookie(sessionCookie);

  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <header className="header">
            <div className="title-block">
              <h1>Codex-Wechat</h1>
            </div>
            <div className="header-actions">
              {authenticated ? <PrimaryNav /> : null}
              {authenticated ? <LogoutForm /> : null}
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
