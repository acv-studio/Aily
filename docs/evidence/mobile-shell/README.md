# Capacitor 双端壳：实际应用视觉证据

## 对比条件

- **Before baseline**：`41c9c98`（本次开发起点，现有 Web 原型），从 Git archive 的隔离目录实际启动。
- **After implementation**：`1df32e80df836efab6b237af05d0ff50195ca9f2`，实际生产构建。
- 两组 Web 对比均为 Chromium、402 × 874 CSS px、DPR 1、深色主题、中文、全新隔离浏览器上下文。
- 场景相同：首次欢迎页，以及完成默认角色引导后“我的”页面、输入同一测试密码并成功下载加密备份后的状态。
- 密码仅为隔离测试数据；没有真实聊天、API Key 或私有来源消息。截图未经设计重绘。
- 视觉未改版，浏览器 Before/After 相同是预期结果。原型此前没有原生工程，**浏览器截图不冒充旧 iOS/Android 安装包**；新增壳的实际启动另列在下方。原生分享/权限的真机验证未由浏览器截图证明。

## Before — baseline `41c9c98`

![Before 欢迎页](<before-welcome.png>)

![Before 浏览器备份下载后](<before-backup.png>)

## After — implementation `1df32e8`

![After 欢迎页](<after-welcome.png>)

![After 浏览器备份下载后](<after-backup.png>)

## 原生启动证据 — 同一 After implementation

iPhone 17 Pro / iOS 26.5 Simulator，1206 × 2622 物理 px（402 × 874 pt），同一首次欢迎状态。通过 `xcrun simctl install` 安装从本次工程编译的 App.app 并启动 `com.aily.app` 后捕获；展示的是应用本地打包资源，不是浏览器、远端开发页或静态设计图。系统状态栏和 WebKit 字体差异属于实际原生运行环境。

![After iOS 本地壳实际启动](<ios-welcome.png>)

Android 验证到 Debug APK 与 release AAB 编译成功；没有 Android 模拟器/真机运行截图，不将编译通过描述为设备权限、分享及媒体能力已验收。

## 复现

[截图脚本](<../../../scripts/capture-mobile-shell.mjs>) 可通过 `BEFORE_URL` / `AFTER_URL` 指定两个**已经运行的真实应用版本**，不会自动伪造 baseline。默认本次隔离 baseline 端口 4186，生产 After 端口 4198；执行 `node scripts/capture-mobile-shell.mjs`。

原生构建、安装产物位置和正式分发限制见[移动端打包说明](<../../mobile-packaging.md>)。
