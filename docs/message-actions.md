# 消息操作：长按与复制

## 使用方式

- 长按已完成的消息约 **450ms**，显示“复制、引用、记住这条、撤回”等操作；普通点击不展开。
- 移动超过 10px、滚动列表、离开消息、触摸取消、第二个手指介入、窗口失焦或切换角色会取消尚未触发的长按，避免滚动时误触。
- 点击其他位置或按 Escape 收起菜单。键盘用户可聚焦消息后按 Enter/空格；桌面右键也可打开菜单。
- 正在发送、已撤回或已失效的消息不能打开菜单。媒体播放控件不触发长按菜单。
- 复制只包含消息原文，保留换行，不增加时间、头像或被引用的其他消息。无文字的图片/语音/视频不提供文字复制。
- 用户消息、AI 消息以及本机应用数据回答都可由用户主动复制；本机数据回答的长期记忆限制仍保留。
- 复制成功才提示“消息已复制”；失败提示重试，不改变输入草稿、不发送消息，也不读取已有剪贴板。

## 实现

- [useMessageLongPress.ts](../src/useMessageLongPress.ts)：统一 Pointer Events 长按、移动阈值及生命周期清理，保留原生纵向滚动。
- [ChatPanel.tsx](../src/ChatPanel.tsx)：实际消息菜单和复制入口；切角色/撤回后失效，复制过程中防重复点击。
- [messageClipboard.ts](../src/messageClipboard.ts)：iOS/Android 使用官方 `@capacitor/clipboard` 8.0.1；Web 优先 Clipboard API，不可用时尝试临时 textarea 的 `execCommand('copy')`，严格验证成功并恢复焦点/选区、清理节点。
- [messageActions.css](../src/messageActions.css)：避免 iOS 默认文字/图片 callout 与自定义菜单冲突，操作按钮至少 44px。

原生复制使用 UIPasteboard/Android ClipboardManager，仅写入用户主动选中的文本；不新增网络传输。操作系统自己的通用剪贴板同步或留存由系统与用户设置控制。

## 验证

- [messageClipboard.test.ts](../src/messageClipboard.test.ts)：18 项通过，覆盖原生成功/失败、Web API 与 fallback、空文本、多行原文、DOM/焦点/选区清理。
- [ChatPanel.messageActions.test.tsx](../src/ChatPanel.messageActions.test.tsx)：20 项通过，覆盖点击不展开、长按阈值、取消/滚动/多点触控、键盘与右键、复制失败与重试、私有回答复制、媒体控件、切角色与撤回、异步复制防重复。
- 消息引用回归改为先通过键盘打开操作菜单，再验证原有引用/撤回行为，没有放宽原断言。
- 共 7 个相关测试文件、103 项通过；这是本次功能相关验证，不代表当前工作树全量回归已通过。

```bash
npx vitest run src/ChatPanel.messageActions.test.tsx src/messageClipboard.test.ts \
  src/ChatPanel.test.tsx src/chatActions.integration.test.tsx src/ChatPanel.appData.test.tsx \
  src/AppDataPanel.test.tsx src/appDataChat.integration.test.tsx
npm run build
npx cap sync
```

同步原生插件并重新构建后，安装同一 Bundle ID 的 Simulator 包，不卸载或清空已有聊天资料。复制交互测试使用平台调用 mock；原生包编译/插件注册核验不能冒充已经在真实手机上手动复制验证。
