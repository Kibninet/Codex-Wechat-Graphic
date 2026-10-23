# Android 0.2.0 验证记录

日期：2026-10-24。

- 相关回归测试 121 项通过，0 失败。覆盖原微信会话隔离、草稿合并、并发、取消、命令去重、图形操作目录、项目目录验证、结构化线程卡片、远程网关及 Markdown/LaTeX 安全渲染。
- 浏览器检查了真实图形指令中心及参数确认面板；渲染样例使用 App 相同资源，行内/独立公式、表格、引用和代码块显示正常。不是手机实机截图。
- 微信生产源码类型检查通过。Web 生产构建与其类型检查通过；存在动态文件路径导致追踪范围过宽的构建警告，尚未精简独立服务器包。
- 使用 JDK 25.0.4.1、Android Platform 35 和 Build Tools 35 构建。APK v2/v3 签名校验通过；逐项核对 APK 内 app.js、controls.js、index.html 与本次源文件一致。
- 之前实际 HTTPS 验证过配对、原微信聊天读取及 40 MiB .bak 上传，文件大小与 SHA-256 一致；没有发送真实微信测试消息。当前改动继续使用同一原微信服务。
- 全仓库广泛类型检查仍有示例包及其他测试的遗留报错，未声称全仓库所有检查通过。
- 尚未在真实 Android 手机上逐项验收新版本的键盘、触感、微信跳转及所有第三方服务功能。原提供方不支持的功能会保留其实际返回，图形入口不代表功能一定可用。
- 手机 5G 需要可达的 HTTPS 服务。临时 Cloudflare 隧道无固定域名和可用性保证，停止失效，地址变化需重新配对；没有新增固定域名或自启动配置。

## 复现

在 app 目录先运行 `npm ci`、`npm --prefix apps/mobile-ui ci --ignore-scripts`、`node scripts/prepare-mobile-assets.mjs`。

```powershell
node scripts/test.mjs test/core/mobile_command_catalog.test.ts test/runtime/weixin_mobile_control.test.ts test/runtime/weixin_inbound_drafts.test.ts test/runtime/weixin_conversation_router.test.ts test/runtime/weixin_bridge_runtime.test.ts test/platforms/weixin/cli.test.ts test/providers/codex/turn_notification_races.test.ts test/web/bridge_control.test.ts test/web/bridge_queries.test.ts test/web/mobile_files_pairing.test.ts test/web/mobile_remote_gateway.test.ts test/web/mobile_rendering.test.ts
npx tsc -p tsconfig.weixin-local.json --noEmit
```

Web 构建：安装 `apps/web` 的锁定依赖后，在该目录运行 `node node_modules/next/dist/bin/next build`。Android 构建参数见 `app/apps/android/README.md`。

APK SHA-256：`7ce16116f9393e76b02dc7e5eebe5cf9a9775c9f5c36a24bda370c82ad94de57`。

补充验证：通过真实公网 HTTPS 入口执行只读“当前聊天状态”和“浏览已有线程”，均返回完成结果；线程列表生成 4 个可点选卡片，没有请求模型生成或发送微信测试消息。

Windows 打包过滤器另有 1 项安全回归通过：排除嵌套 Web 私有环境、构建缓存及 Android 签名文件，保留原桥接源码和离线渲染资源。此项单独使用 `node --test scripts/release-file-filter.test.mjs` 复现，不计入上述 121 项。
