# Aily 移动端打包（iOS + Android 同步首发）

## 交付范围

同一份 React/Vite 生产资源由 Capacitor 8.6.0 打包到两个本地应用中；不是打开远端网站的壳，也不依赖开发服务器。首发目标明确为 **iOS + Android**，不将任一端当作后续移植。现有聊天、记忆、小游戏和演示商城沿用原有实现。

这里交付的是双端工程、可复现的测试包构建和正式打包入口，**不是已经签名上架的应用，也不代表原型所有产品能力已达到商店首发标准**。没有新增真实支付、订阅、推送、账号或默认生产 API Key。

## 环境

- Node.js 22+，使用 `npm ci` 安装锁定依赖。
- iOS：macOS、Xcode 26+（含命令行工具和对应 Simulator runtime）；工程使用 Swift Package Manager，不需要 CocoaPods。最低支持 iOS 16.4（与现有 Web 运行时能力及构建目标一致，不只沿用 Capacitor 模板最低版本）。
- Android：JDK 21、Android SDK Platform 36、Build Tools 36.0.0；设置 `JAVA_HOME` 和 `ANDROID_HOME`，或在本机 `android/local.properties` 设置 `sdk.dir`。最低 Android 7 / API 24，目标 API 36；设备需更新 Android System WebView / Chrome 至 111+。无需安装 Android Studio 即可命令行构建；打开工程需要 Android Studio。
- 第一次构建需要网络下载 npm / Swift / Gradle / Android SDK 依赖；运行已构建的应用不需要开发服务器。

## 开发与测试包

在仓库根目录：

```bash
npm ci
npm test -- --pool=threads
npm run mobile:sync          # 先构建 Web，再同步两个本地工程/插件
npm run mobile:ios           # 同步后打开 Xcode
npm run mobile:android       # 同步后打开 Android Studio
npm run mobile:build:ios     # 无签名 Simulator .app
npm run mobile:build:android # Debug APK（调试签名，不是生产签名）
```

产物：

- iOS：`.mobile-build/ios/Build/Products/Debug-iphonesimulator/App.app`，只能安装到 Simulator；不能安装到 iPhone 或用于 TestFlight。
- Android：`android/app/build/outputs/apk/debug/app-debug.apk`，可用 `adb install -r` 安装到测试设备。

两端都已经纳入 GitHub Actions：Android 回归测试、APK 和未签名 release AAB；iOS Simulator 编译。不上传密钥，也不自动发布。重新修改 Web 代码或插件后必须再次执行同步；直接在原生 IDE 中编译不会自动重建 Web 资源。不要并行运行两个 `mobile:build:*` 命令，它们都会写入同一份 `dist` 和同步目录。

原生工程和依赖锁文件纳入 Git，生成的 Web 拷贝、配置、SDK 路径、构建缓存和证书不纳入 Git。**已有工程不要再次 `cap add`**；使用 `mobile:sync` 更新。

## 正式签名与分发

默认应用 ID / Bundle ID 为 `com.aily.app`，显示名为 Aily。正式发行方必须在第一次分发前确认自己持有这一标识；如需改名，在配置及两个原生工程中一起修改。已安装后保持应用 ID、WebView origin / scheme 稳定，否则本机 IndexedDB 不会自动迁移。当前原生版本为 1.0 / build 1；每次正式上传须递增原生版本/构建号，npm 的 0.1.0 是原型包版本，不会自动同步到商店版本。

### iOS

1. 执行 `npm run mobile:ios`，在 Xcode App target 中配置发行方 Apple Developer Team、签名证书、Bundle ID 和 provisioning profile。
2. 选择真机或 `Any iOS Device`，Product → Archive。通过 Organizer 验证并上传 TestFlight / App Store Connect，或按授权方式导出 IPA。
3. 不把证书、profile 或 Apple 账号凭据提交到仓库。本 PR 不自动创建开发者账号、签名或上传。

### Android

```bash
npm run mobile:bundle:android
# android/app/build/outputs/bundle/release/app-release.aab
```

默认 release **未配置签名，输出的 AAB 是未签名构建检查产物，不能直接上架**。正式包执行 `npm run mobile:android`，在 Android Studio 中 Build → Generate Signed App Bundle or APK，选择 release，使用发行方自己的 upload keystore。通过 Google Play 或目标渠道要求验证、分发；妥善保管密钥以便后续更新。调试密钥不可用于生产，签名材料不能入库。也可在发行方自己的安全构建环境配置 Gradle release signing，当前仓库不内置凭据。

## 本机数据、权限与网络

- WebView origin 为 iOS `capacitor://localhost`、Android `https://localhost`；不跨设备同步，也不读取原来浏览器的 IndexedDB。卸载、清理应用数据或系统存储回收可能使记录丢失。
- Android 禁用自动备份，并明确排除 Android 12+ 云备份与设备迁移；iOS 的系统整机备份是否包含应用数据由系统和用户设置控制，不把“本地优先”宣称为系统永不备份。
- 加密备份：浏览器保留原有下载；原生将**已经加密的** JSON 临时写入应用私有 Cache，交给系统分享/保存。完成分享仅表示交给所选目标，不保证目标已经保存；用户需确认文件可用。取消和失败不提示成功。分享成功后不立即删除缓存，避免 Android 接收方延迟读取失败；系统可以回收缓存。
- 导入继续使用系统文件选择器与原有加密校验；选择备份后输入同一密码。导入会替换当前聊天/记忆，不包含演示钱包或 API Key。换机前须验证备份可解密。
- 麦克风仅在用户点击录音时请求；Android 声明录音权限，iOS 提供用途说明。拒绝后仍可发文字。图片沿用文件选择器，不申请全盘/管理存储权限、不新增后台录音。
- 不配置 `server.url`、不允许 cleartext HTTP、不放宽 iOS ATS。自定义 DeepSeek 地址应为 HTTPS，且服务需支持 WebView origin 的 CORS 与流式响应。保持原来的 Web `fetch` / SSE，不开启会改变流式语义的原生 HTTP 拦截。离线可查看本机记录和使用演示回复；远端模型请求仍需要网络和用户 Key。

## 首发前仍需发行方完成

- 在 **iOS 真机和 Android 目标设备** 验证首次启动、系统返回、键盘/安全区域、旋转、文件选择与导入、分享后真正保存、录音授权/拒绝/回放、后台恢复、本机持久化、低存储及 HTTPS 模型流式请求。模拟器编译与浏览器测试不能替代权限、媒体和文件行为的真机验收。
- 录音、图片和备份仍是本机原型功能；没有模型视觉、语音听写或实时通话。不同厂商 WebView、iOS 版本可能有差异，不承诺全部设备能力已经通过验收。原生系统分享适配在本票覆盖加密备份；已合入 main 的回忆卡 PNG、网页邀请等仍沿用各自 Web 能力与降级提示，需单独在目标设备验证。
- 现有 AppIcon / launch 资源为 Capacitor 模板资源，正式商店需要产品图标与截图。原型的商城余额与送礼不扣款、没有真实 IAP 或订阅权益。
- 完成双方商店的隐私声明、数据收集披露、年龄分级、AI 内容安全、支付/订阅及恢复规则等审核要求。保持用户自带 Key；公开分发前不得在客户端塞入生产默认 Key。

## 验证证据

可复现的应用视觉对比和原生启动截图见 `docs/evidence/mobile-shell/README.md`。对比保留现有视觉，不以新设计取代原型；浏览器 Before/After 不冒充不存在的旧原生安装包。
