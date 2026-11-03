# Capacitor 双端壳：实际应用视觉证据

## 对比条件

- **Before baseline**：`41c9c98`，本票原始开发起点的 Web 原型，从 Git archive 隔离目录实际启动，未重绘或修补源码。
- **After implementation**：`5dc086717f8f3e63964d083bd94d348f1383b85e`，整合当前 main 后的实际应用源码；对应生产资源已完成双端编译。
- 两组 Web 对比均为 Chromium、402 × 874 CSS px、DPR 1、深色主题、中文、减少动态效果、全新隔离上下文；同一 Vite 开发运行方式，不是设计稿。
- 相同场景：首次欢迎页；然后写入相同的隔离测试设置（默认陆听澜、引导完成、测试成年/AI 告知确认）进入“我的”，输入相同测试密码并下载加密备份，滚动到备份面板。测试设置只用于这两个独立浏览器上下文，不改用户数据、不调用模型。
- 本票开发期间 main 合入了九步引导、安全告知、语言设置和新的备份面板。因此 After 的这些界面差异来自已合入 main 的功能，而非本票重新选择视觉设计；本票沿用它们并适配原生导出。Before 仍为原始请求时的真实实现，**不是伪造一个不存在的旧原生包**。
- 截图不包含真实聊天、API Key 或私有来源消息。浏览器截图不能证明原生分享、文件接收和录音权限已经通过真机验收。

## Before — baseline `41c9c98`

![Before 欢迎页](<before-welcome.png>)

![Before 浏览器备份下载后](<before-backup.png>)

## After — implementation `5dc0867`

![After 欢迎页](<after-welcome.png>)

![After 浏览器备份下载后](<after-backup.png>)

## 原生启动证据 — 同一 After implementation

隔离 iPhone 17 Pro / iOS 26.5 Simulator，1206 × 2622 物理 px（402 × 874 pt），首次欢迎状态。安装从同一 After 源码编译的 App.app 并启动 `com.aily.app` 后直接捕获；这是应用本地打包资源，而非浏览器、远端开发页或静态设计图。系统状态栏、字体和系统语言遵循实际 Simulator 环境。

![After iOS 本地壳实际启动](<ios-welcome.png>)

Android 验证到 Debug APK 与 release AAB 编译成功，另通过 lintDebug 和 host unit tests；没有 Android 模拟器/真机运行截图，不把编译与 Mock 测试描述为设备能力验收。

## 复现

[截图脚本](<../../../scripts/capture-mobile-shell.mjs>) 可用 `BEFORE_URL` / `AFTER_URL` 指定两个已运行的真实 Vite 应用版本（脚本在隔离页面中通过源模块设置本机测试状态）。默认 baseline 端口 4186、After 端口 4198；执行 `node scripts/capture-mobile-shell.mjs`。请勿指向日常使用的浏览器上下文；脚本自行创建独立上下文。

原生构建、产物位置和正式分发限制见[移动端打包说明](<../../mobile-packaging.md>)。
