# 主 Bot 应用数据首版：验证记录

验证日期：2026-11-07。基于当前多人修改中的工作树；没有提交或发布线上/商店。已构建无签名 Simulator 包并安装到 iPhone 17 Pro，校验安装资源与构建一致。未导出实际用户数据库，也没有把用户私人数据发给真实模型。

## 1. 本功能专题测试：通过

14 个测试文件，259/259 通过（含安装清单、点名 App 本机查询、数量与临近日期修复）：

| 测试文件 | 数量 | 主要覆盖 |
| --- | ---: | --- |
| [appDataGateway.test.ts](../src/appDataGateway.test.ts) | 46 | 字段白名单、安装状态/世代、防伪/修改/重放、身份/源变化、取消、超时、预算 |
| [appDataProviders.test.ts](../src/appDataProviders.test.ts) | 75 | 全部现有 Provider/schema、损坏数据、缺失数据、完整汇总、独立关键词/日期、媒体无 Blob 输出 |
| [extensionRuntime.test.tsx](../src/extensionRuntime.test.tsx) | 26 | 注册原子性、保留核心 ID、未来应用渲染、删除钩子与注销后 tombstone |
| [AppDataPanel.test.tsx](../src/AppDataPanel.test.tsx) | 8 | 挂载不读数据、本机预览不发送、再次授权、选择变化、非主 Bot/临时/演示模式、未来安装发现 |
| [appDataIntent.test.ts](../src/appDataIntent.test.ts) | 24 | 中英文普通问法、本机安装清单、未来应用、隐私身份限制、清单读取失败 |
| [appDataLocalQuery.test.ts](../src/appDataLocalQuery.test.ts) | 12 | 点名 App 本机查询、空记录、未安装、不调用模型、未来 aliases、时间范围、取消 |
| [appDataCalendar.test.ts](../src/appDataCalendar.test.ts) | 20 | 通用下一次日期、旧年份年度重复、今天/年界/DST/闰年/非法日期 |
| [appDataProviders.calendar.test.ts](../src/appDataProviders.calendar.test.ts) | 9 | 完整来源后分页、未来日期范围、数量统计、媒体范围声明、安全白名单 |
| [appDataNaturalQueries.test.ts](../src/appDataNaturalQueries.test.ts) | 14 | 中文/英文数量、两条最新截图问句、未来 calendar App、最近日志、金额不误作条数 |
| [appDataChat.integration.test.tsx](../src/appDataChat.integration.test.tsx) | 12 | 真实 hook→网关→模型请求→持久化链路、两种模型格式、来源隔离、旧摘要防回流、失败重试 |
| [ChatPanel.appData.test.tsx](../src/ChatPanel.appData.test.tsx) | 4 | 真实聊天入口、背景 inert、主角色限制、发送中 Escape 取消 |
| [appDataBoundary.test.ts](../src/appDataBoundary.test.ts) | 4 | 长字段截断标识、源 revision 不公开、问题/关键词分离、延迟事件下跨页访问版本失效 |
| [futureMiniApp.integration.test.tsx](../src/futureMiniApp.integration.test.tsx) | 2 | 真实首页→商店安装→动态标题→新 App 界面→Bot 发现与读取；未知应用安全降级 |
| [appDataPrivacy.test.ts](../src/appDataPrivacy.test.ts) | 3 | 旧扩展 keys 与访问 nonce 清除、未来 App 注销后数据删除、删除失败后重试 |

```bash
npx vitest run src/appDataLocalQuery.test.ts src/appDataIntent.test.ts src/AppDataPanel.test.tsx src/ChatPanel.appData.test.tsx \
  src/appDataChat.integration.test.tsx src/appDataBoundary.test.ts \
  src/appDataGateway.test.ts src/appDataProviders.test.ts src/extensionRuntime.test.tsx \
  src/futureMiniApp.integration.test.tsx src/appDataPrivacy.test.ts
```

模型请求集成测试使用 mock HTTP 响应，但调用的网关、上下文组装、聊天 hook 和 IndexedDB 持久化均为真实项目实现。

## 2. TypeScript 与生产构建：通过

`npm run build`（`tsc -b && vite build`）成功。生成主 JS bundle 约 990 kB，Vite 提示超过 500 kB chunk 阈值；这是性能提示，不是构建失败。未因此修改项目原有代码分包策略或抑制警告。

期间先遇到并行相册 UI 修改中的组件签名/图标编译错误，检查当前文件后其接口已补全，最终构建成功；未通过覆盖相册功能绕开问题。

## 3. 全量回归：未通过

首版全量记录（17:12 普通安装清单问答补丁之前，16:53 执行 `npm test -- --reporter=dot`）：

- 测试文件：79 通过，26 失败，共 105。
- 测试用例：1424 通过，110 失败，共 1534。
- 本次新增专题测试均通过；失败在其他现有测试文件中。

失败包含现有 onboarding/成人设置旧断言、记忆确认与分享控制、天气/相册/朋友圈 UI、聊天引用操作、备份及提醒界面等不匹配。示例：[chatService.test.ts](../src/chatService.test.ts#L100) 仍要求已有上下文中的旧“成人模式关闭”文案；[useLocalChat.test.tsx](../src/useLocalChat.test.tsx#L366) 仍要求默认 API Key 为空，当前工作树默认值为网关配置。

本次没有为了消除这些失败改写成人策略、恢复旧 UI 或放宽旧测试，也没有对所有非专题失败做修改前基线重放鉴别。**不能将本次交付宣称为全项目回归已通过。** 后续发布前须由各功能维护者统一当前实现与测试合同并重新运行全量。

## 4. 首版保留的边界

- 仅本次明确授权，无永久 grants/自动 planner/后台个人索引。
- 不是手机第三方 App 沙箱数据扫描；未来软件必须遵循 [接入协议](app-data-integration.md)。
- 当前同源受信代码，不能用于加载执行任意第三方脚本。
- 存储变更、安装/身份版本用于失效和发送前复核；跨库写入/最终发送尚无共同原子 fence，已发往服务的请求无法撤回。
- 未来模块注销后 cleanup tombstone 在当前进程保留；重启后宿主仍需加载有保留数据的模块，不能遗失删除责任。
- 媒体仅元数据，无视觉理解、音频转录或自动调用原生权限。
