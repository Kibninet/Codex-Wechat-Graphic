# Codex-Wechat Graphic

Windows x64 本地客户端。通过微信与电脑上的 Codex 对话，电脑负责计算，微信负责收发。内置 Node.js、Codex CLI 和所需依赖，使用时无需另外安装 npm 包。

[下载 Windows x64 完整发行版](https://github.com/Kibninet/Codex-Wechat-Graphic/releases/latest) · [完整指令](./完整指令.md)

## 首次使用

1. 将整个文件夹解压到一个固定位置。不要只复制某个启动文件，也不要直接在 ZIP 里双击运行。
2. 双击 `Codex-Wechat.exe`，在窗口中选择并保存工作目录。点击“登录 Codex”，打开官方授权页并输入窗口中的验证码；再点击“微信扫码登录”，用微信扫描窗口中的二维码，最后点击“启动后台”。
3. 在微信机器人聊天中发送 `/status` 检查状态，再发送文字和文件，最后用 `/send` 一并提交。
4. 用 `/models` 查看当前账号可用模型，用 `/model` 查询或修改。发行版不固定模型、思考强度或项目路径。

首次配置完成后，后台随当前 Windows 用户登录启动。正常重启电脑或 Codex 不必重新扫码。电脑须保持联网且不休眠；微信主动撤销或作废凭据时，需要重新登录。

配置窗口会显示已保存的登录和后台状态。关闭窗口不会停止后台；重新登录会暂停后台，完成后点击“启动后台”。“取消登录”只结束当前授权进程。登录文件存在不代表远端凭据一定有效，实际连接可在微信发送 `/status` 确认。窗口仅调用本包脚本，不启动本地网页服务。源码及重新编译入口位于 `tools/LoginWindow.cs`、`tools/BuildLoginWindow.ps1`。原有 `1-Setup.cmd` 仍可使用。

## 桌面入口

| 文件 | 用途 |
| --- | --- |
| `Codex-Wechat.exe` / `0-Open-Window.cmd` | 打开图形配置窗口，显示二维码、授权码及后台状态 |
| `1-Setup.cmd` | 首次配置或修改工作目录 |
| `2-Start.cmd` | 启动后台并启用自动运行 |
| `3-Stop.cmd` | 停止后台并停用自动恢复 |
| `4-Status.cmd` | 查看后台与自动启动状态 |
| `5-Login-WeChat.cmd` | 仅在需要时重新登录微信 |
| `6-Login-Codex.cmd` | 登录或更换 Codex 账号，随后运行启动入口 |
| `7-Uninstall.cmd` | 移除本发行版后台任务，保留本地数据 |
| `8-Open-Data.cmd` | 打开自己的本地数据目录 |
| `Doctor.cmd` | 显示版本和本地配置状态，不显示令牌或聊天内容 |
| `Self-Test.cmd` | 运行不访问账号、不消耗模型额度的回归自检 |
| `Verify.cmd` | 核对发行包文件的 SHA-256 完整性 |

## 多会话与并行

每条命令单独发送：

```text
/chat new 工作
/chat new 日常
/chat list
/chat use 工作
@日常 解释一下这个概念
@工作 /status
@工作 /stop
```

聊天数量没有写死，每个聊天使用独立线程和上下文，可同时处理任务。普通消息、图片、文件先存入当前聊天草稿，只有 `/send` 才提交给模型；指定会话消息不会改变选择。回复带聊天名，方便辨认较早任务的结果。

```text
/chat list 2
/chat send 工作 帮我整理这个需求
/chat archive 日常
/chat list archived
/chat restore 日常
```

每页显示 20 个聊天。归档保留历史和绑定，运行中的聊天不能归档。聊天状态文件采用原子替换并保留上一份备份，损坏时尝试恢复。多个聊天仍共享所选项目文件；需要同时修改同一文件时，应安排先后顺序。

更多用法见 `完整指令.md`；微信中用 `/helps` 查看总表、`/helps chat` 查看多会话帮助。

## 工作模式与聊天模式

| 命令 | 行为 |
| --- | --- |
| `/mode work` | 工作模式：文字静默存草稿，文件有简短回执；`/send` 一并提交 |
| `/mode chat` | 聊天模式：直接发送文字，回复中继续发送会追加要求，减少系统提醒 |
| `/mode` | 查看模式；模式按聊天保存，重启后保留 |
| `/add 补充要求`、`/send 补充要求` | 立即提交已有草稿和补充内容，运行中尝试追加到当前任务 |
| `/pending`、`/discard`、`/stop` | 查看草稿、清空草稿、停止任务并取消排队输入 |

聊天模式隐藏当前聊天名称前缀，其他聊天后台回复保留来源；错误和审批仍明确提示。切换模式不会立即提交已有草稿；切到聊天模式后，下一条普通消息会与草稿一起提交。模型、权限和项目目录沿用原会话设置。

无法实时追加时明确提示并排到下一轮；无法确认服务端是否接收时保留草稿，不自动重发。文件可先发再补说明，图片也可直接发送。详细示例见 [模式与追加要求](./模式与追加要求.md)。

单个附件上限 100 MiB，单轮最多 20 个附件、100000 字。下载有超时、最多三次尝试和失败提示。未知扩展名可以保存，内容能否解析取决于实际格式及是否加密。

## 默认设置与数据

- 模型由 Codex 和账号的实际可用配置决定，发行包不预置个人模型偏好。
- 默认使用 `default-permissions`。需要其他权限时，可在相应聊天里使用 `/permissions` 查看及选择。
- 微信私聊只接受完成扫码的账号，群聊默认关闭；不开放额外本地 HTTP API。
- 配置、凭据、二维码、聊天绑定、历史和日志均写入 `%LOCALAPPDATA%\Codex-Wechat`，不会回写到发行文件夹。
- 每个用户首次运行都使用自己的登录。发行包不包含任何现成账号、聊天或项目内容。
- 此目录中的数据不应随发行包一起分享。发行包本身可以移动；移动前停止后台，移动后从新位置启动。
- 默认关闭正文调试日志；诊断入口不会打印令牌、账号 ID 或聊天内容。

## 后台与恢复

后台使用无交互窗口宿主，关闭启动终端或 Codex 不会关闭桥接。任务计划每分钟检查一次，已有实例时不重复启动；异常退出时自动重新拉起。正在计算的任务不会在进程崩溃后自动重新执行，恢复连接后可用 `/retry` 重新请求。

微信里的 `/restart` 在 Windows 上通过后台监督进程重启服务子进程，不依赖 Linux 命令。其他聊天仍有任务时，会阻止重启和重连。

如果没有回复，先运行 `4-Status.cmd`、`Doctor.cmd`，确认网络和后台状态。不要将“后台没启动”直接当作“需要重新扫码”。

## 文件校验

Codex-Wechat 支持多会话管理、并行路由、后台自动恢复和图形登录。

运行组件版本记录在 `BUILDINFO.json`。文件校验值位于 `MANIFEST.sha256`；它用于检测文件变化，不是发布者数字签名。源码在 `app/src`，回归用例在 `app/test`，图形窗口源码在 `tools/LoginWindow.cs`，后台宿主源码在 `tools/BridgeHost.cs`。

## 源码开发与构建

Windows x64，安装 Node.js 24 或更新版本（当前发行包使用 24.20.0）。

```powershell
cd app
npm ci
npm test -- test/runtime/weixin_conversation_router.test.ts test/runtime/managed_restart.test.ts test/runtime/weixin_bridge_runtime.test.ts test/platforms/weixin/poller.test.ts
npx tsc -p tsconfig.weixin-local.json --noEmit
cd ..
node scripts/build-windows.mjs
```

构建会从锁文件安装依赖，安装固定版本 Codex CLI，编译桌面窗口与后台宿主，运行自检，生成 ZIP 和 SHA-256 校验文件。产物在 dist/；构建过程不需要登录账号。重新构建时使用空的输出目录，例如 `node scripts/build-windows.mjs --output D:/Builds/release-2`。

可选离线复用已有发行包中的运行依赖：`node scripts/build-windows.mjs --reuse-runtime D:/Apps/Codex-Wechat-0.3.0-windows-x64`。源码仍取自当前仓库。

开发时不要提交自己的 .env、codex-home、weixin、账号 JSON 或日志。发现连接问题时提交去除个人数据后的复现步骤即可。
