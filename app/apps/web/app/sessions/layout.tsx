import type { ReactNode } from 'react';
import { CodexWorkspaceProvider } from '@/components/codex-workspace-context';
import { listWebCodexThreads } from '@/lib/server/queries';
import { getWebPaths } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

export default async function SessionsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const initialThreads = await listWebCodexThreads();

  return (
    <CodexWorkspaceProvider initialThreads={initialThreads} defaultCwd={process.env.CODEXBRIDGE_DEFAULT_CWD || getWebPaths().repoRoot}>
      {children}
    </CodexWorkspaceProvider>
  );
}
