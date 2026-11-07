# 主 Bot 应用数据：使用与新应用接入

当前专题测试 259/259 和生产构建通过；全量工作树仍有非专题回归失败，详见 [验证记录](app-data-verification.md)。

## 已实现的使用方式

普通聊天可直接问“我安装了哪些软件”“我有哪些应用”：主 Bot 从本机安装注册表返回真实清单，区分常驻工具与可选安装，不调用模型、不读取应用内容。新注册应用安装后也自动纳入；临时/非主角色不读取，损坏清单明确报错。实现见 [appDataIntent.ts](../src/appDataIntent.ts)。

也可明确点名查询：“纪念日有哪些数据”“护肤日记有哪些记录”“本月日记正文有哪些数据”。[appDataLocalQuery.ts](../src/appDataLocalQuery.ts) 按注册的 App 名称、英文名和可选 aliases 匹配，只在本机读取请求范围并返回摘要/记录，不调用模型、不扣模型额度。默认选取较低敏的数据范围，明确要求正文/联系方式等时才选择对应字段范围；读取范围会显示。空记录、未安装、无持久接口、读取失败分别说明。未来注册的新 App 同样适用，不需要增添针对它的聊天分支。

支持数量和时间意图，例如“我相册里面有几张照片”“最近的纪念日”“最近的日记”。数量从完整授权范围统计，不用前 20 条明细猜总数，也不输出无关文件名。最近的纪念日按下一次发生日期排序，年度重复按月日计算，2 月 29 日只取下一个合法闰年；普通日志按保存日期倒序。相关声明与通用算法见 [appDataCalendar.ts](../src/appDataCalendar.ts)。

这是用户明确问句触发的本机查看，不是后台扫描或自动外发。需要 AI 分析这些内容时，再走下面的预览授权流程。

**需要 AI 分析，或手动指定读取范围：**

1. 在首页进入当前主 Bot 的聊天。
2. 打开右上角“聊天设置”或输入框旁“更多发送选项”，选择“读取应用数据”。
3. 输入问题，勾选要读取的应用数据范围。日期和记录关键词为独立可选筛选；问题本身不会被当作搜索关键词。
4. 点击“本机读取并预览”。这一步不请求模型；未勾选的数据范围不会调用 Provider。
5. 检查预览、目标服务与模型，勾选本次外发确认，再点击“仅本次授权并询问主 Bot”。

授权仅用于一次问答，没有安装即授权、永久授权或后台批量扫描。临时会话和非主角色不能读应用数据。没有可用模型配置时，本机查询/预览仍可使用，但不会发送给模型。关闭、Escape、停止会取消尚在进行的读取或生成；已发出的数据不能从模型服务撤回。

可用目录包括 7 个常驻应用和已安装的 9 个扩展；当前 App Store、专注时钟、五子棋和梅花易数没有持久业务数据接口，显示明确说明。其余应用按真实存储提供细分 scope：收支汇总/明细/备注、通讯录目录/联系方式、日记索引/正文、媒体元数据、库存/预算/家庭成员/过敏资料/洗碗历史、护肤记录、衣橱、纪念日、2048 分数、笑声元数据和相册整理标记。

相册/音乐只包含用户导入 Aily 的媒体元数据；笑声没有自动转录；不会因 Bot 查询触发系统相册、录音或联系人权限。图片与音频 Blob、URL、任意数据库字段不会发给模型。日期筛选为 `[开始日期,结束日期)`；无日期的数据是当前快照，不冒充历史记录。

网关不把完整数据库复制进聊天。明确本机查询返回的字段会作为本机回答保留，或经授权生成带来源的 AI 回答；这些回答标记 `localOnly + appDataReply`，不会进入后续模型上下文、引用、摘要或自动记忆，“记住这条”也不可用于该回答。旧摘要引用了私有来源 ID 时，在请求前会被排除。手动抄写或用户自行输入的内容不是可自动撤回的 App 副本。

## 实际模块与协议

- [appDataTypes.ts](../src/appDataTypes.ts)：版本化 Manifest、scope、query、result、preview 和一次性 ticket。
- [appDataGateway.ts](../src/appDataGateway.ts)：注册、可用性、安装世代、预览、字段投影、预算、一次性许可、防伪/防修改及发送前源复核。
- [appDataProviders.ts](../src/appDataProviders.ts)：现有应用的只读适配器，按 App 自己的数据合同读取。
- [extensionRuntime.tsx](../src/extensionRuntime.tsx)：未来小应用一次注册，接入商店目录、数据 Provider、组件渲染和资料删除钩子。
- [AppDataPanel.tsx](../src/AppDataPanel.tsx)：实际聊天中的本机预览与外发确认。
- [useLocalChat.ts](../src/useLocalChat.ts) / [chatService.ts](../src/chatService.ts)：真实聊天持久化与两种现有模型请求格式的接线。
- [privacy.ts](../src/privacy.ts)：清除现有扩展资料及未来应用的清理钩子；不因卸载自动删业务数据。

## 新小应用只需注册一次

新应用模块应由宿主在启动时加载并执行 `registerMiniApp()`；是否展示入口、是否可读由现有安装状态决定。**不要只在用户打开应用 UI 后才注册 Provider，也不要仅加载当前已安装应用的模块**：已卸载但保留数据的模块仍需要提供删除钩子。注册不是用户授权。

下面是一个可依照实现的“饮水记录”示例。代码属于受信宿主源码，不是从用户输入下载或 eval 的脚本：

```tsx
import type { AppDataProvider, AppDataResult } from './appDataTypes'
import { registerMiniApp } from './extensionRuntime'
import WaterLogApp from './WaterLogApp'

const appId = 'water-log'
const key = 'aily.app.water-log.entries.v1'
const empty = (status: AppDataResult['status'], revision: string): AppDataResult => ({
  status, revision, records: [], summary: {}, truncated: false,
})

type Entry = { id: string; date: string; ml: number }
function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !v.id || typeof v.date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)
    || !Number.isFinite(Date.parse(`${v.date}T00:00:00Z`))
    || new Date(`${v.date}T00:00:00Z`).toISOString().slice(0, 10) !== v.date) return false
  return typeof v.ml === 'number' && Number.isSafeInteger(v.ml) && v.ml > 0
}

const provider: AppDataProvider = {
  manifest: {
    id: appId, name: '饮水记录', english: 'Water Log',
    availability: 'installable', schemaVersion: 1,
    scopes: [{
      id: 'entries', name: '饮水记录', english: 'Water entries',
      fields: ['date', 'ml', 'count', 'totalMl'], sensitive: true,
    }],
  },
  async read(scope, query, signal) {
    if (scope !== 'entries') return empty('unsupported', 'unsupported')
    signal.throwIfAborted()
    let raw: string | null
    try { raw = localStorage.getItem(key) }
    catch { return empty('unavailable', 'storage-unavailable') }
    // Full-source revision stays private in the Gateway. Hashing full raw is preferable
    // for large stores; never use only the displayed prefix or count as a revision.
    const revision = JSON.stringify(raw)
    if (raw === null) return empty('empty', revision)
    let value: unknown
    try { value = JSON.parse(raw) } catch { return empty('invalid-data', revision) }
    if (!Array.isArray(value) || !value.every(isEntry)
      || new Set(value.map(v => v.id)).size !== value.length) {
      return empty('invalid-data', revision)
    }
    signal.throwIfAborted()
    const entries = value.filter(v => (!query.from || v.date >= query.from)
      && (!query.to || v.date < query.to)
      && (!query.search || v.date.includes(query.search)))
    const totalMl = entries.reduce((sum, entry) => sum + BigInt(entry.ml), 0n)
    return {
      status: entries.length ? 'ok' : 'empty', revision,
      summary: { count: entries.length, totalMl: totalMl.toString() },
      records: entries.slice(0, query.limit).map(v => ({
        id: v.id, fields: { date: v.date, ml: v.ml },
      })),
      truncated: entries.length > query.limit,
    }
  },
}

// name/english/id must match the provider; permanent host IDs cannot be occupied.
export const unregisterWaterLog = registerMiniApp({
  app: {
    id: appId, name: '饮水记录', english: 'Water Log',
    description: '记录每日饮水', englishDescription: 'Track daily water intake',
    icon: '💧', color: '#a9cbe7', category: 'life',
  },
  provider,
  component: WaterLogApp, // component accepts { locale }
  clearData: async () => { localStorage.removeItem(key) },
})
```

执行注册后，应用自动出现在商店；用户安装后，主 Bot 数据选择列表会发现它。新应用的 scope 默认全部未勾选，无需修改主 Bot 的消息逻辑。注册失败会回滚目录、Provider、渲染器及本次清理钩子。未知或未注册的应用显示“应用暂不可用”，不会错误打开 2048。

`unregisterWaterLog()` 注销运行时、移除入口并失效许可，但不清业务数据。内存中的 cleanup tombstone 保留清理能力；同 ID 重注册保留旧版本清理钩子，删除时逐个尝试，失败可重试。跨重启时函数不能自动持久化，因此宿主必须继续加载保留数据应用的模块，或未来提供持久、声明式清理清单。在移除历史应用模块/升级清理方案前，必须先迁移这些删除责任，不能遗失旧数据来源。

### 数量与日历能力声明

`query.operation` 可为 `list/count/recent/upcoming`。`count` 必须对完整筛选范围统计 `summary.count`，不要用已分页的 records 长度猜总数；可用 `scope.countLabel={zh,en}` 明确“照片数量”等含义，用 `manifest.dataBoundary={zh,en}` 说明仅 Aily 导入记录等边界。

有周期日期的 App 可在 scope 声明 `calendar={dateField:'date',yearlyField:'yearly'}`，并在 fields 白名单包含 `nextDate/daysUntil`。`upcoming` 查询带合法 `query.today`，Provider 调用 [applyCalendarQuery](../src/appDataCalendar.ts) 对完整来源先计算下一次日期，再按 `nextDate` 筛选、排序、分页；不能按原年份倒序或先截 20 条。没有周期的 App 可省略 yearlyField。未来日历小应用遵循同一声明，无需增加主 Bot 分支。

## Provider 必须遵守的合同

1. **只读且无交互副作用**：不写数据、不修复损坏源、不调用模型，不触发权限弹窗或原生媒体读取；未知 scope 不能访问任意 key/path。
2. **稳定身份与字段白名单**：Manifest 声明允许字段，records 和 summary 都按白名单投影；JSON 只输出字符串、有限数值、布尔或 null，不输出 Blob、嵌套任意对象、凭据、路径或 URL。
3. **revision 覆盖完整来源**：修改、删除、清空与 schema 变化都应改变 revision。网关私有保存 revision，公共预览/外发不包含其原文。现有媒体通过全部元数据及 size/type 判断变更，依赖文件不可变；将来提供同 ID 替换字节 API 时必须补持久版本或内容摘要。
4. **状态真实**：missing=empty，损坏=invalid-data，存储/权限/超时=unavailable；不能以演示默认数据冒充用户记录。无持久数据的应用使用空 scopes。
5. **区分完整汇总和分页明细**：summary 从整个授权筛选范围计算，records 可分页/限制；金额采用精确整数并将 bigint 转字符串。Provider 自己发生截断需设置 `truncated`，网关字段/整体预算截断也会标明。
6. **日期与关键词分离**：`query.text` 是用户问题，只绑定一次性授权；`query.search` 才是可选记录关键词。`from/to` 是合法日期，结束排他；无日期数据应标明当前快照，不推断历史。
7. **尊重取消**：检查 signal，在长操作期间分段检查，不将 abort 当作成功。
8. **必须提供清理钩子**：清除属于此应用的所有持久业务数据，不触碰其他应用数据；抛出失败供宿主报告，不吞错误假称成功。
9. **升级重新确认**：新增 scope 或改 Provider/Manifest 会使旧预览/票据失效，不迁移用户本次许可；schemaVersion 变更需保留可校验的旧存储迁移，不在只读查询时隐式改库。

## 安全与当前实现边界

- Gateway 只接受自身签发的原始预览和票据，拒绝拷贝、伪造、修改与重放。票据绑定主角色、普通会话、服务/model、问题和安装世代；卸载再装也不能复用。
- 单次最多 20 个 App/scope 选择，每 App 最多 20 条明细，每个字符串最多 300 个 Unicode 字符；整体预览 JSON 最多 12000 个 JS 字符单元且 UTF-8 48 KiB。丢弃整字段/记录，不切坏 JSON。问题最多 300 字，关键词最多 100 字。
- Provider 读取有 5 秒超时。模型发送前再次读取完整来源版本并复核身份/安装状态，单个源失败在预览中显示跳过。
- 无永久数据索引、无限时授权或审计正文库；取消或结束后预览/票据丢弃，不进入聊天备份。
- 当前是同源受信宿主代码的逻辑权限层，不是第三方执行沙箱。下载任意 JS 并执行不在支持范围；外部应用需要隔离与正式授权协议。
- 变更事件用于保守取消，在发送前也会重读；当前跨标签页存储没有统一原子锁，检查/发送仍有极短竞态窗口，不能承诺已经发出的数据可被撤回。严苛生产场景需让全部 App 写入和最终发送共用 repository fence/Web Lock。
- 这不是扫描手机所有第三方软件的私有数据。外部软件须通过官方 API/OAuth、用户导入或受支持的系统接口适配后注册。

## 验证命令

```bash
npx vitest run src/appDataLocalQuery.test.ts src/appDataIntent.test.ts src/AppDataPanel.test.tsx src/ChatPanel.appData.test.tsx \
  src/appDataChat.integration.test.tsx src/appDataBoundary.test.ts \
  src/appDataGateway.test.ts src/appDataProviders.test.ts src/extensionRuntime.test.tsx \
  src/futureMiniApp.integration.test.tsx src/appDataPrivacy.test.ts
npm test
npm run build
```

专题测试覆盖：未来应用注册→商店安装→Provider 读取→渲染；默认未授权；本机预览与外发分离；字段/预算/日期/关键词；伪造、重放与安装世代；主 Bot/服务/来源变更；两种模型请求；Escape 取消；私有回答及旧摘要防回流；失败重试；注销后的删除钩子。专题测试通过不等于当前工作树全量回归通过，请同时查看全量运行结果。
