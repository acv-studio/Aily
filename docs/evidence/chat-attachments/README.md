# 聊天右侧「＋」附件菜单

保留深色聊天风格与发送按钮，将照片入口收纳到输入框右侧的圆形「＋」。语音按钮位于输入框左侧，展开菜单提供照片、视频、表情。

- 照片：PNG/JPEG/WebP/GIF，3MiB 内；先本机预览再发送。
- 视频：MP4/WebM/MOV，20MiB 内；先预览再发送，消息内提供原生播放控件。播放取决于浏览器编解码支持，不支持时提示尝试 MP4/H.264。
- 表情：24 个常用 Unicode 表情，插入当前输入光标处，点击发送才会发出；未增加贴纸商店或在线 GIF 搜索。
- 普通会话照片、视频存本机 IndexedDB，可刷新回看并随现有备份导入导出；临时会话不落盘。撤回移除附件数据。不会把照片、视频或语音发送给文字模型，不提供视觉理解。
- 菜单支持再次点击加号、Escape、点聊天区或输入框收起。回复、录音或读取附件时禁用相关附件操作；切换角色/临时模式清除待发附件。

## 实际界面

![展开菜单](<menu-detail.png>)

- [手机完整菜单](<menu-mobile.png>)
- [表情面板](<emoji-mobile.png>)
- [视频刷新后回看](<video-after-reload.png>)

## 验证

```bash
npm test -- src/ChatAttachments.test.tsx src/ChatPanel.test.tsx src/db.test.ts src/useLocalChat.test.tsx src/chatService.test.ts
npm run build
node scripts/verify-chat-attachments.mjs
```

浏览器脚本使用隔离用户数据，并连接已有 `http://127.0.0.1:4175/`，不会清除真实用户记录。浏览器内生成真实 WebM，验证原生文件选择、图片/视频预览和发送、视频刷新后可播放、撤回，以及 320/390/938px 布局和英文菜单。
