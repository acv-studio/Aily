# 相册“我的”页面：主题对比度修正

## 原因与修复

深色模式将页面文字切为浅色，但“我的相册”的卡片仍使用固定白色背景；标题和操作按钮继承了页面浅色文字，出现白底浅字。卡片图标也固定为深绿，在深色卡片上不够清晰。

[tools-photo-theme.css](../src/tools-photo-theme.css) 现将卡片、标题、正文、按钮、图标及禁用状态分别绑定到同一套主题 token：背景和前景成对变化。修复限于相册整理，不改变其他应用主题、照片数据或权限逻辑；待清理列表、确认卡片等同类表面也采用配对 token。

## 实际 WebKit 页面验证

[scripts/verify-photo-profile-theme.mjs](../scripts/verify-photo-profile-theme.mjs) 在现有 Aily 开发服务上加载真实 React 页面及全部样式，使用独立浏览器资料，显式安装相册整理并进入“我的”。只模拟原生能力可用性，以便检查两个按钮；没有读取用户相册、请求系统授权或调用模型。

浅色与深色均检查文字、按钮、禁用状态 ≥ 4.5:1，图标 ≥ 3:1；不仅检查 CSS 字符串或 JSDOM DOM。

| 深色项目 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 卡片标题 | 1.12:1 | 10.93:1 |
| 读取系统相册 / 选择本地照片 | 约 1.00:1 | 8.80:1 |
| 卡片正文 | 4.15:1 | 7.31:1 |

- [深色修复前](../.mobile-build/photo-profile-theme/before-dark.png)
- [深色修复后](../.mobile-build/photo-profile-theme/after-dark.png)
- [浅色修复后](../.mobile-build/photo-profile-theme/after-light.png)
- [实际计算样式报告](../.mobile-build/photo-profile-theme/after-contrast.json)

```bash
node scripts/verify-photo-profile-theme.mjs
npx vitest run src/PhotoOrganizerApp.test.tsx src/PhotoOrganizerDesign.test.tsx \
  src/PhotoOrganizerTheme.test.tsx src/PhotoSwipeStage.test.tsx src/PendingPhotoList.test.tsx
npm run build
```

5 个相关测试文件、26 项通过；生产构建通过。截图是实际 WebKit 浏览器渲染，不冒充原生模拟器截屏或实际系统相册数据。模拟器安装保持原 Bundle ID，不卸载、不清空记录。
