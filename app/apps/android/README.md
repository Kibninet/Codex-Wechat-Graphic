# Codex-Wechat Android

原微信桥接的手机管理器。App 操作正在运行的微信进程，共用微信逻辑会话、已绑定的 Codex 线程、草稿、模型设置、工作/聊天模式和任务取消机制。最终回复仍通过原微信通道投递，没有独立模型客户端。

支持新建及切换命名聊天、预览原聊天记录、上传多个附件并与文字一起提交、提交微信中暂存的草稿、任务状态、停止任务、模型及思考强度选择、切换工作/聊天模式，以及确认当前任务审批。

## 使用

1. 电脑桥接配置 `CODEXBRIDGE_MOBILE_CONTROL_ENABLED=1`，启动原微信服务。
2. 按现有 Web 控制台配置设置认证和桥接状态目录，构建并启动 Web 管理服务。手机需能访问服务地址。
3. 在电脑 `/phone` 页面下载 APK、生成有效期 10 分钟的一次性配对链接。
4. Android 8 或更新版本安装 APK，在 App 粘贴配对链接。以后启动复用本机保存的凭据。认证配置变化或清除 App 数据后需重新配对。
5. App 内切换聊天会同步改变微信当前聊天；提交进入原微信桥接的 `/send` 流程。回到微信查看最终回复。

单文件上限 100 MiB，每轮最多 20 个 App 附件。文件先流式上传到电脑，明确提交后才进入微信会话。局域网模式会过滤常见虚拟网卡；手机使用 5G 时需要 HTTPS 远程入口。

## 5G 远程管理

可复用官方 Cloudflare Tunnel 提供 HTTPS 中转，无需给 APK 增加独立模型功能。运行前先启动已有 Web 管理服务，然后在普通终端执行：

```powershell
node scripts/run-mobile-remote.mjs --cloudflared 'C:\tools\cloudflared.exe' --state-dir 'C:\private\bridge-state'
```

脚本先在电脑回环地址启动手机专用网关，再启动官方隧道。只转发配对及 APK 使用的微信管理 API，不转发电脑登录、后台服务启停、桌面网页或远程生成配对码接口；原有认证继续生效。网关还检查请求来源、限制配对频率及上传大小。

隧道生成的 HTTPS 地址保存在私有状态目录 `mobile/remote-endpoint.json`，本机配对页会优先生成该远程地址的链接。APK 已支持 HTTPS，因此无需为切换地址重新安装。管理请求及 App 上传的文件经 Cloudflare 中转，微信最终回复继续走原微信通道。

Quick Tunnel 用于临时验证，没有稳定域名或可用性保证；停止后链接失效，重新启动地址变化，需要重新配对。尚未配置固定域名和自启动。长期运行应使用用户自己的固定 HTTPS 服务或命名隧道，设置 `CODEXBRIDGE_MOBILE_PUBLIC_URL`。相关限制见 [Cloudflare 官方说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。

## 构建

使用已有 JDK、Android SDK Platform 35 和 Build Tools 35，不依赖 Gradle。保留同一个私有签名目录，才能覆盖安装后续版本。

```powershell
node scripts/build-android.mjs --java-home 'C:\path\to\jdk' --build-tools 'C:\path\to\build-tools\35.0.0' --android-jar 'C:\path\to\platforms\android-35\android.jar' --signing-dir 'C:\private\android-signing' --out 'C:\output\Codex-Wechat-Android-0.2.0.apk'
```

构建会验证 APK 签名、生成 SHA-256 文件，并把通用前端资源和 APK 同步到 Web 的 public 目录。签名密钥、配对凭据和桥接账号配置不进入安装包或源码。

## 实现边界

- 手机只有网络权限，文件选择使用 Android 系统选择器，不申请全盘、无障碍或微信数据库读取权限。
- 原微信进程控制口仅监听电脑回环地址，随机令牌认证；外层 Web 管理口沿用登录认证与请求来源检查。
- 手机凭据使用 AndroidKeyStore 与 AES-GCM 加密保存。局域网 HTTP 连接仍没有传输加密；公网地址要求 HTTPS。
- 提交带持久化幂等编号。连接超时后重试相同请求，不再向微信桥接重复提交。
- 本轮完成编译、签名校验、服务端联动测试和浏览器响应式预览，尚未在真实 Android 手机安装验收。

## 0.2.0 图形操作与阅读

- 左上角聊天列表可新建、切换，管理面板可重命名、归档、恢复、查看和清空微信草稿。
- 当前项目目录单独显示；切换项目目录会为当前命名聊天创建新线程。聊天名称、项目文件夹及原线程是不同概念，旧历史保留但不自动复制。
- 顶部图形指令中心提供 11 个分类、118 项结构化操作，覆盖原桥接 44 类公开指令；搜索功能名、选择选项、填写参数即可。线程、技能、插件、连接应用和 MCP 列表返回可点选操作卡片。模型配置使用专门的模型选择器。
- 原有确认草稿、实验功能开关及提供方限制继续适用。审批按钮绑定当前具体请求，避免对过期审批操作。微信保活的单独 `/` 仍需从微信本人发送，App 无法替用户伪造这条微信消息。
- 回答和管理结果渲染 Markdown（标题、列表、表格、引用、代码块）与 LaTeX（行内、独立公式）。代码保留原文并提供复制按钮，公式错误保留源文本；运行时使用随包资源。
- 按键增加按下动效、忙碌指示、成功/失败反馈；原生按压反馈遵循手机系统设置。重复提交使用幂等编号，任务结束后自动读取原线程最新回答。减少动态效果设置受到尊重。

首次构建需在 app 根目录运行 `npm --prefix apps/mobile-ui ci --ignore-scripts`。渲染依赖固定版本和完整性记录在其 package-lock.json，许可文本随生成的 vendor 目录打包；源码与 App 不包含个人账号、目录或模型偏好。
