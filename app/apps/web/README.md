# Codex-Wechat 手机管理服务

Android App 将原微信指令图形化，复用电脑原微信进程；没有独立模型客户端。普通回复仍发回微信，App 读取同一线程历史并渲染 Markdown 与 LaTeX。

## 从源码部署

本模块是可选的手机管理服务；既有 Windows ZIP 不包含本次新增的 Web 依赖。首次运行本版本需部署更新后的桥接源码及此服务。以下命令从仓库的 app 目录执行，要求 Node.js 24 或更新版本。

```powershell
npm ci
npm --prefix apps/mobile-ui ci --ignore-scripts
node scripts/prepare-mobile-assets.mjs
npm --prefix apps/web ci
```

启动原微信桥接前，在它实际使用的私有环境配置中设置 `CODEXBRIDGE_MOBILE_CONTROL_ENABLED=1`。沿用自己的微信/Codex 登录与状态目录，不要创建第二份账号状态。若使用发行版后台，环境配置通常在自己的 `%LOCALAPPDATA%\Codex-Wechat\bridge.env`；配置工具可能重新生成该文件，请在启动环境中保留此开关。

在 `apps/web/.env.local` 配置下列值，文件不能提交：

```dotenv
CODEXBRIDGE_WEB_USERNAME=phone
CODEXBRIDGE_WEB_PASSWORD=<自己生成的随机密码>
CODEXBRIDGE_WEB_SESSION_SECRET=<另一段独立随机值>
CODEXBRIDGE_WEB_STATE_DIR=<原微信桥接使用的状态目录>
CODEX_HOME=<原桥接使用的Codex主目录>
```

生成随机值可使用 Node 内置 crypto，例如 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`。默认工作目录和提供方继续由原桥接管理；不把个人模型或项目写进源码。可选 `CODEXBRIDGE_WEB_REPO_ROOT` 指向本模块所在的 app 根目录；默认会自动推导。

```powershell
cd apps/web
node node_modules/next/dist/bin/next build
node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 58888
```

在电脑访问 `http://127.0.0.1:58888/phone`，使用自己配置的账号登录、生成配对链接。手机安装 Android APK 后粘贴链接。局域网入口要求手机能访问电脑；配对候选会过滤 WSL、Hyper-V 等常见虚拟网卡。

## 手机 5G

使用自己的固定 HTTPS 入口，或在 app 目录使用官方 cloudflared 启动临时验证：

```powershell
node scripts/run-mobile-remote.mjs --cloudflared 'C:\tools\cloudflared.exe' --state-dir 'C:\private\bridge-state'
```

`--state-dir` 必须与原微信桥接一致。脚本只转发 APK 管理 API；电脑网页、登录入口和后台服务控制接口不转发。原微信指令中心中的功能仍按用户选项调用原桥接。通过 Cloudflare 的管理请求和文件会经其中转。

临时域名停止后失效，重启地址会变化并需重新配对；没有固定域名或自启动保证。固定服务可通过 `CODEXBRIDGE_MOBILE_PUBLIC_URL=https://自己的域名` 配置。见 [Cloudflare 文档](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。

## 构建 Android

先安装手机 UI 的锁定依赖，再执行 `scripts/build-android.mjs`；参数及签名目录要求见 `apps/android/README.md`。APK 内包含渲染器和字体，运行时不依赖外部 CDN。不要发布签名密钥、私有环境配置、配对票据、账号或聊天记录。
