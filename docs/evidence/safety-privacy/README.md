# 安全与隐私视觉证据

- Before：基线 `6fc3f97dc54ca9885bf767e43cd0ee754e3470f9`，修改前实际运行捕获。
- After：本 PR 的 `feat: add prototype safety disclosure and local privacy deletion` 提交，截图与该提交的 UI 一致。
- 两组同场景：新建隔离浏览器、陆听澜默认角色、欢迎页未勾选 / 未继续；完成引导后进入“我的”，API 未配置、无旧聊天。
- 相同视口 390 × 844、设备比例 1、dark、reduced motion、Asia/Shanghai。使用 fullPage 捕获，新增说明带来的页面高度不同不是视口变化。
- 所有数据均为隔离测试上下文产生，不含用户、飞书或真实凭据。没有调用真实模型。

| 场景 | Before | After |
| --- | --- | --- |
| 首次欢迎与身份告知 | [Before 欢迎](before-welcome.png) | [After 欢迎与成年确认](after-welcome.png) |
| 我的页入口 | [Before 我的](before-profile.png) | [After 我的与安全隐私入口](after-profile.png) |

新增流程：
- [安全与隐私说明](after-privacy.png)
- [不可撤销删除确认](after-delete-confirm.png)
- [本机危机支持回复](after-crisis.png)
- [320px 欢迎页](after-welcome-320.png)

浏览器验证：成年与披露确认 → 引导 → 隐私说明 → 取消删除 → 自伤本地支持回复 → 刷新保留 → 第二标签页占用时拒绝删除且记录仍在 → 关闭第二页后重试成功 → 刷新回到未勾选引导；320px 无横向溢出；无浏览器异常。
