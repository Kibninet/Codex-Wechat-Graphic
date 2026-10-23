export const WEIXIN_CONVERSATION_HELP = [
  '/chat new 名字 — 新建并切换（省略名字可自动命名）',
  '/chat list [页码] — 分页查看聊天和运行状态',
  '/chat use 名字 — 切换聊天，已有任务继续运行',
  '/chat rename 新名字 — 重命名当前聊天',
  '/chat send 名字 内容 — 不切换聊天，直接向指定聊天发送内容',
  '/chat archive 名字 — 归档空闲聊天，历史保留',
  '/chat list archived [页码] — 查看已归档聊天',
  '/chat restore 名字 — 恢复已归档聊天',
  '@名字 内容 — 向指定聊天发消息，不切换当前聊天',
  '@名字 /stop — 停止指定聊天的任务',
  '普通消息及图片、文件发给当前聊天。/new 会重建当前聊天的线程；增加聊天请用 /chat new。',
].join('\n');
