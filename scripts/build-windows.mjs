import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.3.0';
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build on Windows x64 with Node.js 24 or later.');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or later is required.');
const outIndex = process.argv.indexOf('--output');
const reuseIndex = process.argv.indexOf('--reuse-runtime');
const output = path.resolve(outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, 'dist'));
const reuse = reuseIndex >= 0 ? path.resolve(process.argv[reuseIndex + 1]) : null;
const release = path.join(output, `Codex-Wechat-${version}-windows-x64`);
const cache = path.join(root, '.build');
if (fs.existsSync(release) || fs.existsSync(`${release}.zip`)) throw new Error('Output exists. Choose a new --output directory to preserve the previous build.');
fs.mkdirSync(release, { recursive: true });
fs.mkdirSync(cache, { recursive: true });
const write = (relative, content, bom = false) => {
  const target = path.join(release, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, (bom ? '\uFEFF' : '') + content.replace(/^\uFEFF/, ''), 'utf8');
};
const copy = (source, relative) => {
  const target = path.join(release, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
};
const npm = (args, cwd) => execFileSync('npm.cmd', args, { cwd, shell: true, stdio: 'inherit', windowsHide: true });
const powershell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const runPS = (script, args = []) => execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
  windowsHide: true, stdio: 'inherit',
  env: { ...process.env, PSModulePath: path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/Modules') },
});
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name);
  if (entry.isSymbolicLink()) throw new Error('Symbolic links are not supported in a release.');
  return entry.isDirectory() ? files(target) : [target];
});
const dependencySource = reuse ? path.join(reuse, 'app') : path.join(root, 'app');
if (!reuse) npm(['ci', '--no-audit', '--no-fund'], dependencySource);
fs.cpSync(path.join(root, 'app'), path.join(release, 'app'), {
  recursive: true,
  filter: source => !path.relative(path.join(root, 'app'), source).split(path.sep).includes('node_modules'),
});
const dependencies = path.join(dependencySource, 'node_modules');
if (!fs.existsSync(path.join(dependencies, 'tsx/package.json'))) throw new Error('Dependencies are incomplete.');
fs.cpSync(dependencies, path.join(release, 'app/node_modules'), {
  recursive: true, dereference: true,
  filter(source) {
    const relative = path.relative(dependencies, source).replaceAll('\\', '/');
    return !/^(?:\.bin|\.cache)(?:\/|$)/.test(relative)
      && !/^ffprobe-static\/bin\/(?:darwin|linux)(?:\/|$)/.test(relative)
      && !/^ffprobe-static\/bin\/win32\/ia32(?:\/|$)/.test(relative);
  },
});
if (reuse) {
  fs.cpSync(path.join(reuse, 'runtime'), path.join(release, 'runtime'), { recursive: true });
} else {
  const codexCache = path.join(cache, 'codex');
  fs.mkdirSync(codexCache, { recursive: true });
  npm(['install', '--no-audit', '--no-fund', '--ignore-scripts', '@openai/codex@0.163.0'], codexCache);
  fs.cpSync(path.join(codexCache, 'node_modules/@openai/codex-win32-x64'), path.join(release, 'runtime/codex'), { recursive: true });
  copy(path.join(codexCache, 'node_modules/@openai/codex/README.md'), 'runtime/codex/README.md');
  copy(path.join(dependencies, 'typescript/LICENSE.txt'), 'runtime/codex/LICENSE-APACHE-2.0.txt');
  copy(process.execPath, 'runtime/node/node.exe');
  const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!license.ok) throw new Error('Could not download the pinned Node.js license.');
  write('runtime/node/LICENSE.txt', await license.text());
}
const codexVersion = JSON.parse(fs.readFileSync(path.join(release, 'runtime/codex/package.json'), 'utf8')).version;
if (codexVersion !== '0.163.0-win32-x64') throw new Error('Unexpected Codex runtime version.');
const node = path.join(release, 'runtime/node/node.exe');
const nodeVersion = execFileSync(node, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
if (Number(nodeVersion.slice(1).split('.')[0]) < 24) throw new Error('Invalid bundled Node runtime.');
for (const file of files(path.join(root, 'tools'))) {
  const relative = path.relative(root, file);
  if (file.endsWith('.exe')) continue;
  if (file.endsWith('.ps1')) write(relative, fs.readFileSync(file, 'utf8'), true); else copy(file, relative);
}
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name.endsWith('.cmd') || entry.name.endsWith('.md') || entry.name === 'settings.example.json')) copy(path.join(root, entry.name), entry.name);
}
copy(path.join(root, 'THIRD-PARTY-NOTICES.txt'), 'runtime/THIRD-PARTY-NOTICES.txt');
runPS(path.join(release, 'tools/BuildHost.ps1'));
runPS(path.join(release, 'tools/BuildLoginWindow.ps1'));
runPS(path.join(release, 'tools/Manage.ps1'), ['-Action', 'Test', '-DataDir', path.join(cache, 'test-state')]);
write('BUILDINFO.json', JSON.stringify({ name: 'Codex-Wechat Graphic', version, platform: 'windows-x64', builtAt: new Date().toISOString(), node: nodeVersion, codex: codexVersion, includesPersonalData: false, setupRequired: true }, null, 2) + '\n');
const payload = files(release);
const forbidden = /(?:^|\/)(?:\.git|\.env(?:\.[^/]*)?|auth\.json|bridge\.env|service\.pid|[^/]+\.log)(?:\/|$)/i;
const privateFile = payload.find(file => forbidden.test(path.relative(release, file).replaceAll('\\', '/')));
if (privateFile) throw new Error('Private runtime data found in the build.');
const identity = process.env.USERNAME;
const patterns = [root, root.replaceAll('\\', '/'), identity].filter(value => value && value.length > 1).flatMap(value => [Buffer.from(value), Buffer.from(value, 'utf16le')]);
for (const file of payload) {
  const content = fs.readFileSync(file);
  if (patterns.some(pattern => content.includes(pattern))) throw new Error(`Personal path or local identity in ${path.relative(release, file)}`);
}
write('PRIVACY-AUDIT.json', JSON.stringify({ passed: true, runtimeCredentialsIncluded: false, chatHistoryIncluded: false, personalPathsIncluded: false, checks: ['source and tool allowlist', 'runtime filename exclusions', 'local identity and path scan'] }, null, 2) + '\n');
const manifest = files(release).sort().map(file => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.relative(release, file).replaceAll('\\', '/')}`);
write('MANIFEST.sha256', manifest.join('\n') + '\n');
runPS(path.join(root, 'scripts/BuildArchive.ps1'), ['-ReleaseDir', release, '-ReportPath', path.join(cache, 'archive-verification.json')]);
console.log(`Built and verified: ${release}.zip`);
