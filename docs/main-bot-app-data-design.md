# 主 Bot 统一应用数据读取机制

> 原始架构蓝图。已实现首版“逐次选择 → 本机预览 → 本次授权 → 主 Bot 回答”及未来小应用注册协议，真实接口与使用方式见 [应用数据接入说明](app-data-integration.md)。本文的持久 grants、自动 query planner、完整审计和统一写入锁等是后续设计，不代表首版已实现。范围：Aily 内置小应用，不是读取手机上任意第三方 App 的私有数据。

## 1. 目标与现状

目标是让主 Bot **具备查询全部已安装 App 的能力**，而不是每轮对话都复制全部 App 数据。用户可问“这个月花了多少钱”“冰箱里还有什么”“最近记录了哪些开心的事”，也可主动请求跨应用的生活概览。

源码事实：

- [extensionApps.ts](../src/extensionApps.ts#L1-L16) 注册 9 个扩展 App，`aily.extension-apps.v1` 保存安装 ID；安装不是下载外部程序。
- [HomeScreen.tsx](../src/HomeScreen.tsx#L20-L28) 另有常驻应用：记账、相册、通讯录、音乐、日记、应用商店、梅花易数。这些目前不在扩展安装列表里。
- 主 Bot 是主角色，身份来自 onboarding profile；不是独立服务器 Agent，见 [App.tsx](../src/App.tsx#L87-L88)。
- [useLocalChat.ts](../src/useLocalChat.ts#L249-L326) 发起聊天；[chatService.ts](../src/chatService.ts#L199-L241) 组装聊天、确认记忆和摘要，当前没有统一 App 数据入口。
- 本地数据分散在 localStorage 和多个 IndexedDB。部分小应用仅保存 React 内存状态；不能宣称已有历史数据。
- 个人工具当前明确承诺不上传，见 [personalToolsStorage.tsx](../src/personalToolsStorage.tsx#L77-L79)。新增模型读取必须更新这些说明，并重新取得用户同意。

**边界**：普通 iOS/Android App 无权读取其他 App 的沙箱。未来接入外部服务必须通过官方 API/OAuth、用户主动导入、系统选择器或官方授权接口；本设计不扫描系统私有数据库，不使用越狱/root 绕过权限。

## 2. 架构：Registry + Provider + Gateway + Context

```text
用户问题 / 用户点击生活概览
       ↓
App Query Planner（本地意图路由 / 明确选择 App）
       ↓
App Data Gateway
  ├─ App Registry：是否常驻/已安装、能力清单
  ├─ Access Policy：主 Bot、数据范围、外发对象、授权版本
  ├─ Providers：各 App 的只读适配器
  └─ 预算、来源、有效性校验、审计与取消
       ↓
App Context：与本轮相关的结构化数据，独立于长期记忆
       ↓
chatService：最终授权复核 → 发送给用户配置的模型
       ↓
带应用来源的回答 / 打开对应 App 查看原记录
```

主 Bot 不接触 storage key、数据库对象或任意文件路径；只调用网关。数据源继续归原 App 所有，不为 Bot 建一份完整副本，也不要求先统一迁移所有数据库。

这是一层可信宿主代码内的逻辑访问控制，不是安全沙箱：当前同源 JS 原本能访问同源存储。未来允许第三方代码时，必须使用隔离 iframe/独立源、受限消息协议或服务端鉴权，不能把 TypeScript 接口当安全隔离。

## 3. 统一 App 注册表

建立一份 `AppManifest`，同时驱动安装发现、商店能力说明和 Bot 查询目录。避免 UI 中一套 App 名单、Bot 中另一套。

- `appId`：稳定 ID，复用现有 ID，不用中文名称做主键。
- `availability`：`builtin` 或 `installable`。常驻应用是可用，不是自动获授权。
- `providerVersion` / `schemaVersion`：兼容版本。
- `scopes`：各数据集、允许字段、敏感度、支持的查询操作。
- `topics`：本地意图路由词，不含用户记录。
- `openSource(recordRef)`：受控打开应用原记录，不接收记录中的任意 URL。

`listAvailableApps()` 返回常驻应用加上当前已安装扩展；应用商店本身只提供目录元信息。已卸载但保留数据的应用必须排除。注册却没有 provider 时返回 `unsupported`，不能扫描未知 key 补全。

安装状态读取失败应显式返回错误并拒绝扩展查询；不能沿用当前返回空数组的便捷函数来判断“用户确实没有安装”。重复/未知安装 ID 必须校验和去重，读取不修复原始数据。

## 4. Provider 与查询协议

以下为拟定接口，不是当前项目已存在的 API：

```ts
type AppDataQuery = {
  appId: string;
  scope: string;
  operation: 'summary' | 'search' | 'list' | 'get';
  text?: string;
  recordIds?: string[];
  from?: string;        // inclusive
  to?: string;          // exclusive
  timeZone: string;     // 来自设备/用户明确设置
  limit: number;
  cursor?: string;      // 网关签发，绑定查询与授权版本
};

type SourceRef = {
  appId: string;
  scope: string;
  recordId: string;
  revision: string;
};

type AppDataPage = {
  status: 'ok' | 'empty' | 'denied' | 'not-installed'
    | 'unsupported' | 'unavailable' | 'invalid-data';
  records: Array<{
    source: SourceRef;
    fields: Record<string, string | number | boolean | null>;
  }>;
  aggregate?: Record<string, string | number | boolean | null>;
  readAt: string;
  sourceRevision?: string;
  truncated: boolean;
  nextCursor?: string;
};

interface AppDataProvider {
  query(query: AppDataQuery, signal: AbortSignal): Promise<AppDataPage>;
  validateSources(refs: SourceRef[]): Promise<boolean>;
}
```

网关只接受已注册 scope/operation/字段，严格校验日期、长度、数量、cursor；拒绝 SQL、任意 key/path、任意脚本和未经注册的查询。授权检查在调用 provider 前执行，字段白名单投影在结果返回前再执行。Provider 不决定权限、不开授权弹窗、不发网络请求、不写数据。

`summary` 在本地对授权范围内完整数据计算，例如月支出按分类汇总，而不是给模型 20 条流水让它猜月总额。明细可以分页；汇总扫描若超出预算必须返回部分覆盖标识/不可用，不能把部分总额当完整结果。跨币种必须分别汇总，不虚构汇率。缺日期的记录不参与日期统计，明确报告。

## 5. 授权模型

授权不是“安装即同意”。默认所有个人数据 scope 关闭。

每条 grant 绑定：本机资料命名空间、主角色 ID、App ID、scope、允许字段、`summary/detail` 等级、有效期、授权版本、外发服务身份。外发服务按规范化的 endpoint origin + path 和模型标识绑定，不包含 API Key；修改服务/模型需重新确认外发授权。当前没有线上账户，不能声称具备服务器级用户隔离。

两层独立许可：

1. **本机访问**：允许 Aily 本地查询并展示结果。
2. **模型外发**：允许向明确展示的模型服务发送哪些字段。只有本机许可时可展示本地结果，但不得把结果放进 AI 请求。

用户体验：

- “我的 → 主 Bot 数据权限”：列出全部可用 App、scope、最近访问、撤销入口。
- 首次请求显示“读取哪些应用 / 哪个时间范围 / 哪些字段 / 发往哪个服务”，可只允许本次，或持续允许指定低敏 scope。
- 可批量授权低敏摘要，但新安装 App、新增 scope、敏感字段不能继承笼统授权。
- 日记正文、通讯录电话/邮箱、健康相关状态及自由文本、财务明细：默认本次授权，可先预览后发送。
- 临时会话完全不读取 App 记录、个人索引或 App 缓存，包括原来已有持续授权的 App。
- 非主角色不能读取 App 数据；切换主 Bot 后旧 grant 不转移，重新确认新角色。
- 无 Key 演示模式不假装模型已经读过数据；允许明确标注的本地查询结果，禁止把 App 私密数据送入演示回复/自动记忆。

## 6. 查询与模型接入流程

MVP 使用本地意图路由，不依赖供应商 tool calling：

1. 捕获请求角色、临时状态、当前主 Bot、主角色/政策版本和取消信号。
2. 先做现有用户输入安全检查；命中本地安全回复时不查询 App。附件轮次继续遵守只本地保存的边界。
3. 本地选择相关 App。不明确时问用户或展示选择卡片；“所有应用概览”是明确跨应用请求，查询所有已授权摘要，未授权应用显示跳过。
4. 取得授权；等待用户期间不预读未授权记录，不占用模型计费额度。问题、主角色、服务或查询范围变化后原确认失效。
5. 网关读取并本地汇总/投影。明细默认每 App 最多 20 条、3 个相关 App；跨应用概览可覆盖全部已授权 App，但每个只取短摘要。
6. App 上下文初始硬预算：序列化 JSON 最多 6000 字符且 UTF-8 最多 24 KiB，每条摘录最多 300 字符；最终上下文还须按选定模型 token 上限裁剪，优先保留安全规则和当前问题。标明任何截断，不裁坏 JSON。
7. 紧邻实际 fetch 再验证安装状态、主角色、授权、endpoint/model 和来源版本；变化就丢弃 App context，必要时重新确认。网关不得返回过期的“授权快照”后直接外发。
8. 在请求中增加独立 `appContext`，与已确认记忆分开。固定系统规则只说明这是不可信引用数据；数据用受限 JSON 数据块，不拼成额外权限/操作指令。
9. 回答标注真实来源和覆盖范围，例如“根据记账里 11 月已保存的记录……”，不将随机穿搭、虚构剧情、饮食推荐当作真实发生事件。无资料/无权限/读取失败分别说明。
10. 显示来源卡片，点击进入 App。单个 provider 失败不使全部聊天失败；展示跳过项，不使用旧缓存冒充最新。

后续如提供工具调用，仅暴露 `list_app_capabilities`、`query_app_data` 两个受限工具；模型仅建议查询，由宿主重复鉴权。限制调用次数/总预算，工具调用不直接下载音频、读图片、打电话、删除或修改 App 数据。

## 7. 新鲜度、撤销与隐私删除

- MVP 默认现读现用、仅本轮内存缓存，不建持久个人索引，避免复制私密记录与遗漏删除。
- 每个 provider 输出来源 revision；旧记录没更新时间时用本地规范化内容摘要识别变化，不伪造发生时间。修订/删除后原来源失效。
- 将统一 `app-data-changed` 事件接到成功保存/删除后，并监听跨标签页 storage/BroadcastChannel；事件用于失效和取消，不当作权限凭据。事件丢失也必须靠发请求前重读发现。
- localStorage 多 key、不同数据库不支持共同事务。当前 2048 两个 key 分别保存：不可声称棋盘和分数是原子快照。MVP 仅返回可独立成立的字段；未来统一单 key/版本化 repository 后才支持组合快照。
- 仅靠事件与“fetch 前再检查”不能彻底消除跨标签页检查/发送竞态。严格上线版须让 grant 变更、卸载及来源写入与最终检查/发起请求共同遵守短时 Web Lock/统一 repository fence；锁仅覆盖验证与发起，不持有到流式回复完成。无法获得一致性协调时，敏感外发 fail closed。已开始的网络请求仍不能保证撤销其服务端接收，不能承诺零泄漏或撤回已发送数据。
- 撤销、卸载、切换主 Bot、删除资料：递增政策版本、清除内存结果并 abort 尚未发送/进行中的相关请求。重新安装不恢复旧许可。
- 将 App 来源依赖记录在关联回答上；日后历史上下文、引用、摘要及记忆提取必须排除已经失效的 App 来源回答，防止撤销后从 Bot 旧回答再次泄漏。仅丢弃新 appContext 不够。
- MVP 不自动把 App 数据或其派生回答转成长期记忆。用户要“记住”时另行确认，并保存来源依赖；源删除/撤销后按来源规则停用。独立用户新输入不自动视为 App 授权。
- 已发到模型的内容、已显示的回答及用户导出的副本无法远程撤回；权限面板明确区分“停止今后读取”和“删除本机相关回答”。
- 审计仅记录 requestId、App/scope、操作、时间、字段数/条数、成功或拒绝原因、服务标识，不保存查询原文、记录正文、电话、API Key。建议本地最多保留 30 天/500 条，并纳入隐私清除。
- [privacy.ts](../src/privacy.ts#L23-L39) 的删除流程需纳入全部 provider 数据、grants、审计及派生来源。当前 localStorage 清理是显式名单；实施时必须补齐扩展 keys，不能只清新建网关的表。授权不随聊天备份导出/导入，避免换设备后默默重新外发。

## 8. 当前全部 App 的 Provider 接入矩阵

下表是源码盘点，不代表已经读取用户的实际记录。scope 名为拟定名称；所有个人数据默认关闭。

| App ID | 真实数据源 | 建议查询范围 / 注意事项 |
| --- | --- | --- |
| `ledger` | `aily-desktop-ledger`，见 [LedgerApp.tsx](../src/LedgerApp.tsx#L7-L33) | `totals`：日期范围内人民币收支/分类汇总；`entries`：日期、分类、金额，备注另授权。整数分精确计算，bigint 汇总转十进制字符串后序列化，不能强转 number 丢精度。 |
| `contacts` | `aily-desktop-contacts`，见 [ContactsApp.tsx](../src/ContactsApp.tsx#L5-L15) | `directory`：姓名、分组、收藏；`contact-details`：用户选中联系人的电话/邮箱。本机手建通讯录，不是系统通讯录；未知 metadata 不透传。 |
| `diary` | `aily-desktop-diary`，见 [DiaryApp.tsx](../src/DiaryApp.tsx#L7-L19) | `entries`：日期、正文、可选 mood；正文及心情须单独授权，不推断心理诊断。未保存草稿不读。 |
| `album` / `music` | `aily-media-library-v1.items` 按 kind 隔离，见 [mediaLibrary.ts](../src/mediaLibrary.ts#L3-L15) | `metadata`：导入文件名称、类型、收藏、集合、加入日期、大小。名称/集合也可能敏感；不含 Blob、对象 URL、图片描述、歌词或艺术家推断。 |
| `meal-planner` | `aily.ext.meal.v1` 的 settings/history，见 [MealPlannerApp.tsx](../src/MealPlannerApp.tsx) 与 [mealPlanner.ts](../src/mealPlanner.ts#L5-L13) | `pantry`、`budget`、`wash-history`；成员偏好/过敏信息另授权。食材目录用于名称/单位映射，价格是离线估价。无保存数据时不返回 defaultSettings 冒充用户事实；当前没有完整用餐/购物/做菜历史。 |
| `skincare-diary` | `aily.ext.skincare`，见 [ExtensionAppViews.tsx](../src/ExtensionAppViews.tsx#L7-L8) | `entries`：日期、早晚、产品、状态、备注；健康相关字段及自由文本单独授权。 |
| `wardrobe` | `aily.ext.wardrobe`，见 [ExtensionAppViews.tsx](../src/ExtensionAppViews.tsx#L10-L11) | `items`：衣物名、分类、颜色、季节；随机 outfit 仅内存，不能声称用户当天实际穿了它。 |
| `anniversary` | `aily.ext.anniversary`，见 [ExtensionAppViews.tsx](../src/ExtensionAppViews.tsx#L13-L14) | `dates`：名称、日期、是否逐年重复；倒计时本地派生，明确时区及闰日规则。 |
| `game-2048` | `aily.ext.2048.grid` / `aily.ext.2048.score`，见 [ExtensionAppViews.tsx](../src/ExtensionAppViews.tsx#L18-L20) | `state`：保存分数或棋盘；没有最高分/历史统计。组合状态须解决两 key 非原子写入后才可保证一致。 |
| `laughter-collector` | `aily-laughter-v1.recordings`，见 [laughterStorage.ts](../src/laughterStorage.ts#L3-L15) | `metadata`：录音名、人物、日期、时长、剪辑 sourceId；人物/名称也须许可。没有已有文字转录，不能让文字模型声称听过笑声。 |
| `photo-organizer` | `aily-media-library-v1.photoDecisions`，见 [mediaLibrary.ts](../src/mediaLibrary.ts#L5-L12) 和 [PhotoOrganizerApp.tsx](../src/PhotoOrganizerApp.tsx) | `decisions`：保留/待删除标记、更新时间；`pending` 不是已删除。Aily 照片可关联本地元数据；native 列表仅组件内存，可能失去系统许可，不自动调用原生 listPhotos/getPhoto，不把孤立标记当作仍可访问的系统照片。 |
| `focus-timer` / `gomoku` / `divination` | 当前仅组件内存，见 [ExtensionStore.tsx](../src/ExtensionStore.tsx)、[ExtensionAppViews.tsx](../src/ExtensionAppViews.tsx#L16) 和 [DesktopTools.tsx](../src/DesktopTools.tsx) | 注册能力说明并返回 `unsupported`（无持久历史）。如需 Bot 查询正在进行的会话，应另设计显式前台 session provider，不能虚构专注时长或卦象历史。 |
| `app-store` | `aily.extension-apps.v1` | 仅安装目录，无用户内容 provider。 |

实际路由以 [DesktopTools.tsx:81](../src/DesktopTools.tsx#L81) 为准；同文件旧内联 Ledger/Contacts/Diary/LocalMedia 未挂载，不能作为新 Provider 的真实数据合同。

旧 `useStored` 会吞掉存储错误并回退默认值，见 [ExtensionAppViews.tsx](../src/ExtensionAppViews.tsx#L5)。Provider 应采用严格只读解析与字段白名单，不能复用其 fallback 当作有效事实。对 IDB 媒体查询，MVP 即使只输出元数据，读取整条记录仍可能将 Blob 带入本地内存；应分页限制读取，后续再迁移独立 metadata 表优化，不将其误称为“完全不加载 Blob”。

## 9. 工程落点与实施顺序

拟新增模块：App registry、provider 类型、只读 providers、policy store、gateway、本地 query planner、权限/预览面板。名称可采用 `appRegistry.ts`、`appDataGateway.ts` 等；本次不创建占位运行时代码。

接线位置：

- [extensionApps.ts](../src/extensionApps.ts)：安装/卸载同步撤销与版本变化，保持旧 key 兼容；逐步让统一 registry 驱动商店/桌面。
- [useLocalChat.ts](../src/useLocalChat.ts#L249-L326)：读取请求身份、规划查询、授权、取消和重试；重试重新读取和鉴权，不复用旧外发许可。
- [chatService.ts](../src/chatService.ts#L81-L105)：新增可选 App 上下文合同，默认无上下文不改变老调用；在 [发送位置](../src/chatService.ts#L360-L395) 做最终复核，兼容两种现有模型请求格式。
- [chatService.ts](../src/chatService.ts#L199-L241)：来源数据块、覆盖范围、整体预算；与历史失效规则一起接入。
- [personalToolsStorage.tsx](../src/personalToolsStorage.tsx#L25-L64) 及各独立 repository：复用校验器、只读加载和写后事件，不挂载 React 组件取数据。
- [privacy.ts](../src/privacy.ts)：完整资料清除；导入/清空流程应取消在途查询并失效来源。

分三阶段：

1. **基础设施 + 垂直验证**：registry、policy、网关、权限 UI、真实聊天接线；先打通记账摘要、衣橱和纪念日，验证撤销与主角色边界。
2. **全 App 覆盖**：逐个 provider，日记/通讯录增加本次预览，媒体仅元数据；无持久历史 App 明确返回 `unsupported`。验收矩阵中每个可用 App 必须有 provider 或清晰的无数据能力说明。
3. **增强**：安全的跨应用概览、受限工具调用、可选本地增量索引；只有完成来源追踪和失效删除后才建立持久派生索引。

交付测试至少包括：未授权零 provider 读取；卸载保留数据但不可查询；重装不自动授权；常驻 App 仍需许可；非主角色/临时模式零读取；等待授权时切角色；修改 endpoint/model；跨页撤销及 fetch 前变化；损坏数据不变成 empty；单应用失败降级；全文超限和恶意记录指令；统计覆盖/币种/时区正确；照片音频 Blob 不外发；源删除后历史回流被阻断；重试不复用授权；隐私清除覆盖全部 provider；两种模型请求都附带同一受限数据块。

**完成标准**不是类型检查通过：必须运行现有测试与 build，并通过真实“App 保存 → 主 Bot 请求 → 用户授权 → 带来源回答 → 撤销/删除 → 后续不再外发”的端到端链路。此文档交付不代表上述机制已经上线。
