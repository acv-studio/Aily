# 液态玻璃关系反馈 · 实际应用视觉证据

## 场景与拍摄方式

- **Before 基线**：`d6fca6e2cf98191b4bab20b3c6ae6928b258ca3b`，独立 detached worktree。
- **After 修改版**：`17ec3eca4cafc5ace7f61d3689ebdfac1a5285c9`（motion implementation），后续提交仅添加本证据文档和截图。
- Chromium，390 × 844，深色，简体中文，Asia/Shanghai，正常动效；英文聊天比较只切换界面语言。补充减少动态效果的 320 × 740 检查。
- 相同合成用户“小雨”、角色陆听澜、称呼初始回忆和待确认共同经历“我们约好周末一起去看海”。确认该记忆后，关系从初遇到熟悉；演示充值 100 币后送一束鲜花，余额 90。
- 图片均来自实际 React 应用，不是设计稿。After 的关系、记忆与礼物截图暂停真实动画在 **240ms**，展示代表性中间帧，**不是静止终态**。装饰最终消失，内容保持可读。
- 基线合并丢失 App/Onboarding 的 `t`、`useI18n`、LanguageSettings imports，导致原应用无法启动；浏览器响应仅补回这些 imports 来拍摄既有基线 UI，没有改动基线 markup、样式、业务数据或重绘 UI。脚本中保留该处理。修改版修复了这些缺失与同一批已验证功能的合并接线回归。
- 基线中 RelationshipPanel 的导入仍存在，但调用被合并丢失，所以 **Before 没有关系面板**；After 恢复此前已实现的关系阶段/共同事件/专属称呼接线，再添加有限的升级反馈。这不是把新面板伪装成旧实现；关系评分规则、确认和付费边界未改动。

## Before / After

| 场景 | Before | After |
| --- | --- | --- |
| 确认共同经历后的关系状态 | [Before](before-relationship.png) | [After · 240ms](after-relationship.png) |
| 确认后的记忆浮现，滚动到同一记忆 | [Before](before-memory.png) | [After · 240ms](after-memory.png) |
| 鲜花赠送成功回应 | [Before](before-gift.png) | [After · 240ms](after-gift.png) |
| 首次引导，补回既有语言设置接线 | [Before](before-onboarding.png) | [After](after-onboarding.png) |
| 英文空聊天，恢复既有翻译包装 | [Before](before-chat-en.png) | [After](after-chat-en.png) |

[After · 减少动态效果与 320px 布局](after-reduced-320.png)

## 验证

```bash
npm ci
npm test
npm run build
# 修改版：npm run dev -- --host 127.0.0.1 --port 4329 --strictPort
# 基线独立 worktree：同命令使用 4330 端口
node scripts/verify-glass-motion.mjs --before
node scripts/verify-glass-motion.mjs
```

- 全部 42 个测试文件、593 项断言通过，生产构建与 `git diff --check` 通过。
- 浏览器验证：新确认触发关系升级，成功礼物回应、减少动态效果无动画、装饰不拦截点击、320px 无横向溢出、浏览器无未捕获错误。
- 独立代码/浏览器复核：初始加载、切换角色不庆祝；暂停/恢复、关闭/恢复类别、删除后恢复旧确认不伪装新升级；减少动态效果中途开启会取消进行中的动画。
- 动效不写入业务数据，不改变确认/引用/关系规则，不触发真实支付或模型请求。记忆入场最多覆盖前六张可引用卡，动画有限且没有持续 blur/filter 动画。

## 已知限制

- 礼物仍为固定本地演示回应，不是 AI 生成；不新增聊天记忆或关系权益。
- 现有生产包仍有 500kB 分块大小提醒；本次不做模块拆包。
- 新增于其他工作的回复模式选择器和深度/剧情演示文案仍有部分中文；本次恢复已有英文聊天控件，不宣称新模式英文覆盖完整。
- 没有真机 iOS/Android 或真实模型服务验证；动效以本地 Chromium 和减少动态效果路径验证。
