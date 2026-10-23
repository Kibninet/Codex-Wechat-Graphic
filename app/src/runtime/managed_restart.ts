/** Exit only the serving child; its supervisor retains credentials and restarts it. */
export function scheduleManagedWindowsRestart({
  platform = process.platform,
  env = process.env,
  exit = (code: number) => process.exit(code),
  schedule = (callback: () => void, delay: number) => setTimeout(callback, delay),
}: {
  platform?: string;
  env?: Record<string, string | undefined>;
  exit?: (code: number) => void;
  schedule?: (callback: () => void, delay: number) => unknown;
} = {}): boolean {
  if (platform !== 'win32') return false;
  if (env.CODEXBRIDGE_SERVICE_MANAGED !== '1') {
    throw new Error('Windows /restart requires the background service. Start the bridge using its launcher first.');
  }
  schedule(() => exit(0), 250);
  return true;
}
