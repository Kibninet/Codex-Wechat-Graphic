import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { getWebAuthConfig, isAuthenticatedCookie } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

function resolveErrorMessage(error: string | undefined) {
  if (error === 'invalid') {
    return '账号或密码错误。';
  }
  if (error === 'config') {
    return '服务端还没有配置 Web 登录账号密码。';
  }
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const config = getWebAuthConfig();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(config.cookieName)?.value;
  const authenticated = await isAuthenticatedCookie(sessionCookie);

  if (authenticated) {
    redirect('/control');
  }

  const errorValue = params.error;
  const error = Array.isArray(errorValue) ? errorValue[0] : errorValue;
  const errorMessage = resolveErrorMessage(error);

  return (
    <section className="auth-shell">
      <article className="auth-card">
        <div className="auth-copy">
          <img src="/icons/codex-wechat.svg" alt="" width="56" height="56" />
          <h1>连接你的电脑</h1>
          <p>登录 Codex-Wechat，打开聊天与电脑控制台。</p>
        </div>

        {!config.enabled ? (
          <div className="auth-alert auth-alert-danger">
            <strong>未完成配置</strong>
            <p>请先在服务端设置 `CODEXBRIDGE_WEB_USERNAME` 和 `CODEXBRIDGE_WEB_PASSWORD`。</p>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="auth-alert auth-alert-danger">
            <strong>登录失败</strong>
            <p>{errorMessage}</p>
          </div>
        ) : null}

        <LoginForm disabled={!config.enabled} />

        <div className="auth-hint">
          <p>使用这台电脑配置的控制台账号和密码登录。</p>
          <p>手机需要能够访问电脑的控制台地址。</p>
        </div>
      </article>
    </section>
  );
}
