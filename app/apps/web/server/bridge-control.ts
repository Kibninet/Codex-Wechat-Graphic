import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export type BridgeAction = 'status' | 'start' | 'stop';
type CommandResult = { stdout: string; stderr: string };
type Runner = (file: string, args: string[]) => Promise<CommandResult>;

// The script location comes only from the computer's local configuration.
// A phone request can select a fixed action, never a command or path.
export function createBridgeController({
  scriptPath = process.env.CODEXBRIDGE_WEB_SERVICE_SCRIPT,
  platform = process.platform,
  exists = fs.existsSync,
  run = async (file, args) => execFileAsync(file, args, {
    windowsHide: true, timeout: 35_000, maxBuffer: 64 * 1024, encoding: 'utf8',
  }),
}: { scriptPath?: string; platform?: string; exists?: (p: string) => boolean; run?: Runner } = {}) {
  let inFlight = false;
  return async (action: BridgeAction) => {
    if (!['status', 'start', 'stop'].includes(action)) throw new Error('不支持这个操作');
    if (platform !== 'win32' || !scriptPath || !path.isAbsolute(scriptPath) || !exists(scriptPath)) {
      return { configured: false, running: null, message: '尚未配置这台电脑的桥接管理入口' };
    }
    if (inFlight) throw new Error('正在执行上一次操作，请稍候');
    inFlight = true;
    try {
      const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath, '-Action', { status: 'Status', start: 'Start', stop: 'Stop' }[action]]);
      const output = result.stdout.trim();
      const running = /Bridge (?:running|started|already running)\b/i.test(output) ? true
        : /Bridge stopped\b/i.test(output) ? false : null;
      return { configured: true, running,
        message: running === true ? '电脑桥接正在运行' : running === false ? '电脑桥接已停止' : '操作已执行，状态待确认' };
    } finally { inFlight = false; }
  };
}

export const controlBridge = createBridgeController();
