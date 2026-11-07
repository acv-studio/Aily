# 客户端本地提醒通知

## 使用

在「提醒 → 智能提醒 → 系统本地通知」主动开启通知并接受系统权限。默认关闭，不在启动时自动申请权限。可点击「发送测试通知」，约 3 秒后检查系统横幅、通知中心或锁屏；Android 普通定时可能延迟。

- 已保存的喝水、吃饭、计划、预计地铁时间可登记为系统本地通知，不需要后端、APNs 或 FCM。
- 点击通知进入提醒列表并定位对应提醒；「完成 / 10 分钟后」动作会打开客户端，核验当前提醒后处理，不是假装 JavaScript 能在所有后台状态持续运行。
- 暂停、删除、完成和稍后提醒会同步更新/取消本应用提醒队列。
- 重复提醒沿用原模型：用户完成本次后，才安排下一次未来时段，不补发积压次数。
- 天气/心情是用户手动记录的本机条件，仅在应用可见时检查；未触发的条件不预测后台天气或心理状态。已经触发且仍新鲜的条件可通知一次；明确选择稍后提醒后按其时间安排。

## 平台与边界

- 使用官方 `@capacitor/local-notifications` 8.3.1，`@capacitor/app` 8.x 提供返回前台事件。
- iOS 系统待处理本地通知数量有限：本实现每次最多登记最近 60 条当前提醒，预留系统容量，并扣除 SDK 可见的其他通知占用。超出容量的提醒保留在本机，打开客户端时补排；不承诺永不打开应用也能收到所有未登记的提醒。
- Android 13+ 需要 `POST_NOTIFICATIONS`。本阶段显式使用 `isExactNotification: false`，从合并 manifest 移除 SDK 传递的精确闹钟权限，不额外弹出「闹钟和提醒」授权。Doze、厂商省电或私密空间锁定可能延迟或隐藏通知，不适合作为紧急/秒级精准闹钟。
- 浏览器和缺少原生插件的旧安装包只保留应用内提醒；需要重新同步并构建原生包才能使用系统通知。
- 安排成功不是送达回执。用户的通知权限、渠道、专注模式、锁屏预览和提示音设置优先。
- 免打扰使用设备当地时间，支持跨午夜及全天免打扰。地铁提醒保留已有的免打扰例外，但不宣称识别真实到站。改变时区后请打开应用重新同步。

## 隐私与可靠性

默认通知只显示通用 Aily 提醒，不包含提醒正文、天气/心情、站点或出口。只有用户开启「显示具体内容」才使用其手动填写的信息；锁屏实际展示仍受系统控制。

通知设置和发生次序账本保存在私有 `__reminderNotifications:v1` 设置键，不进入聊天备份。没有设备推送 token、邮件凭证、远程通知服务器或上传接口。

- 本应用占用整数 ID 区间 `[1700000000, 1799999999)`，使用 `extra.owner = aily.reminders.v1` 和每次配置的随机 epoch。
- 每条当前提醒发生次数有独立 ID/token/时间快照。旧通知不能完成下一次重复或下一次稍后提醒；删除、关闭、被替换后，旧操作无效。
- SDK 8.3 的 Android `getPending` 实际可包含已触发存储记录，故使用 `getAll(SCHEDULED/TRIGGERED)` 读取明确状态。
- 取消时重新核验 SDK 当前归属；显式标记其他 namespace 的同整数 ID 不受旧账本支配。
- 先保存身份账本再提交 SDK；权限拒绝和提交失败撤回未真正提交的发生次数认领，避免永久漏排。
- 提醒事务成功但 SDK 失败时，提醒仍显示保存成功；专用通知错误提示要求重试同步，不能让用户重复添加同一条提醒。
- 资料清除和备份替换先取消本应用系统通知。取消失败会中止私有数据清除，保留重试需要的信息；不清除其他通知。
- 原生 action listener 在早期建立，系统保留的冷启动操作可缓冲到客户端授权/读取完成；React 卸载不会抹掉已提交的系统排程。

## 验证

新增/复用测试涵盖：计划时间、跨午夜与 DST、仅一条当前发生次数、隐私、容量、显式授权、拒绝与权限变化、旧 token、相同整数 ID 的其他归属、取消失败、提交中的关闭/重置、真实 IndexedDB 提醒事务与通知动作、资料清除边界。

```bash
npx vitest run src/localNotificationPlan.test.ts src/reminderEvents.test.ts \
  src/reminderNotifications.test.ts src/reminderNotificationIntegration.test.ts \
  src/useSmartReminders.test.tsx src/useSmartReminders.notifications.test.tsx \
  src/ReminderNotificationSettings.test.tsx src/SmartReminderPanel.test.tsx
TZ=America/New_York npx vitest run src/localNotificationPlan.test.ts
npm run build
npx cap sync
```

原生编译与 mock 测试不能代替真机授权、后台展示、锁屏与省电场景验证。测试通知不会自动发送，需用户在客户端主动触发。
