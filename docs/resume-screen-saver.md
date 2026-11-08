# 后台返回：主 Bot 屏保

## 行为

- 冷启动正常进入原应用流程，不自动弹屏保。
- 已完成引导和安全确认后，从后台返回显示全屏主 Bot 屏保。加载中、未完成授权、邀请落地页或资料删除阶段不显示，不能借屏保绕过授权。
- 屏保始终显示已配置的主 Bot，不是当前临时选中的其他聊天角色；使用主 Bot 的显示名。
- 主 Bot 的回复请求仍在进行时显示“正在回复你的消息 / 当前会话状态”。闲置时从 [resumeScenes.ts](../src/resumeScenes.ts) 的角色场景池选择：每个角色 12 条，按设备当地时间分为晨间、白天、傍晚和夜间，在同一应用会话中避免连续重复。场景带对应图标和中英文氛围短句；一次屏保停留期间不会随每次时钟刷新乱跳。明确标注“AI角色场景 · 本机演示/非真人”，不冒充真实后台活动，不新增模型请求或记忆。
- “进入聊天”直接打开主 Bot 会话，并关闭设置、历史、故事、通话、送礼和经期记录面板等阻挡聊天的 UI。
- 屏保使用覆盖层，不先销毁原页面；当前 DOM、聊天草稿和页面进度保持挂载。进入聊天是明确导航动作，同一主角色的聊天草稿继续保留；切到不同角色仍遵守原有角色隔离，不把其他角色草稿带过去。
- 主 Bot 已提交的回复继续进行，包括自动查询应用数据的回复；若另一个角色仍在回复，会先停止并等待其请求收尾，再安全切换主 Bot。保存尚未完成时等待或明确提示重试，不打开错误角色。

## 生命周期和界面

- [useAppResume.ts](../src/useAppResume.ts)：原生使用官方 `@capacitor/app` 8.1.2 的 `pause/resume/appStateChange`。iOS 仅 pause 记录后台进入；Android 仅 `appStateChange(false)` 记录 Activity 已停止。resume 或 active true 消费一次，冷启动和重复恢复事件不触发。
- iOS pause 对应 `didEnterBackground`，resume 对应 `willEnterForeground`；iOS inactive false 可能只是权限提示，不作为后台证据。Android pause 对应 `onPause`，短暂系统打断也可能发生；只暂停而没有 stop 时不弹屏保。Android inactive false 对应 `onStop`，外部全屏选择器也可能触发，不能将其等同于进程被系统杀死。
- [useAndroidBack.ts](../src/useAndroidBack.ts)：Android 系统返回键先关闭当前弹层，再处理 React 页面导航；聊天返回首页，屏保上返回也进入首页，不循环进入聊天。首页没有其他导航时才最小化应用；不会强制退出或清空资料。聊天左上角返回明确进入首页，同角色重新打开聊天保留草稿。
- Web 使用 document hidden → visible；原生监听不可用时才退回 Web，避免双通道重复。监听 Promise 迟到、失败及 unmount 都正确清理，不使用全局 removeAllListeners。
- [ResumeScreenSaver.tsx](../src/ResumeScreenSaver.tsx) / [resumeScreenSaver.css](../src/resumeScreenSaver.css)：本机时间、主角色头像、柔和呼吸动效、状态、显著聊天按钮；支持浅/深色、安全区域及减少动效。
- 屏保临时隔离后台 DOM 和 portal 的 inert/aria-hidden，拦截隐藏页面焦点陷阱，关闭后准确复原。没有新建模型请求、读取私人 App 数据或写入故事/记忆。
- [App.tsx](../src/App.tsx) 负责授权、当前主角色及直接进入聊天的协调；[ChatPanel.tsx](../src/ChatPanel.tsx) 通过 resumeSignal 收起阻挡 UI，不重建消息数据。
- 应用数据通过普通聊天自动查询，没有需屏保接手或关闭的手动授权面板；进入主 Bot 会话不额外触发数据读取或模型请求。

## 验证

```bash
npx vitest run src/useAndroidBack.test.tsx src/useAppResume.test.tsx src/ResumeScreenSaver.test.tsx \
  src/App.screenSaver.test.tsx src/ChatPanel.appData.test.tsx \
  src/ChatPanel.messageActions.test.tsx src/AppDataPanel.test.tsx
npm run build
npx cap sync
```

以下为屏保首版的历史验证范围；自动读取改版后的结果以重新运行上述命令为准：

- [useAppResume.test.tsx](../src/useAppResume.test.tsx)：25 项生命周期和监听清理测试。
- [ResumeScreenSaver.test.tsx](../src/ResumeScreenSaver.test.tsx)：13 项展示、焦点、背景隔离、草稿节点保留与时钟清理测试。
- [App.screenSaver.test.tsx](../src/App.screenSaver.test.tsx)：9 项真实 App/hook/IndexedDB 导航测试，包括冷启动、授权、主角色、草稿、已有回复和无需应用数据设置的聊天入口。
- 长按操作和相关聊天入口回归：32 项通过。

Web/TypeScript 与 iOS Simulator 构建成功，安装资源及 AppPlugin 注册核验通过。在 iPhone 17 Pro 模拟器中切换到系统“设置”，再重新调起 Aily（不使用 terminate），实际出现屏保，截图见 [模拟器后台返回屏保](../.mobile-build/ios-17-pro-app-data/resume-screen-saver.png)。直接进入主 Bot 聊天和已有回复继续由上述真实 App/hook 导航测试覆盖，不冒充真机触控验收。

本记录为本次相关测试，不宣称工作树所有原有回归已通过。原生包安装保持 `com.aily.app` 和 WebView origin，不卸载或清空本机资料。模型响应在 UI 测试中可控 mock，不代表已请求真实模型服务。
