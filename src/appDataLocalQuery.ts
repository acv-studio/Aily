import type { Locale } from './i18n'
import type { AppDataIdentity, AppDataManifest, AppDataQuery, AppDataScope } from './appDataTypes'
import { discardAppDataPreview, listRegisteredAppDataManifests, previewAppData } from './appDataGateway'
import { initializeAppDataProviders } from './appDataProviders'
import { extensionApps, extensionInstallationSnapshot } from './extensionApps'
import { isInstalledAppsQuestion } from './appDataIntent'
import { assessUserInput } from './safety'

const quantityIntent = /数量|总数|有多少|有几|多少(?:张|条|个|首|段|位|件)|几(?:张|条|个|首|段|位|件)|\b(?:how many|number of|count)\b/i
const upcomingIntent = /最近|最近的|下一个|下一次|即将|快到|临近|马上|接下来|\b(?:nearest|next|upcoming|soonest|closest)\b/i
const recentIntent = /最近|最新|近期|近几|最后|\b(?:recent|latest|last)\b/i
const readIntent = /数据|记录|内容|正文|查看|查询|读取|列出|有哪些|有什么|有啥|写了什么|写过什么|记了什么|花了多少|还剩|剩余|有没有|统计|列表|看一下|看看|\b(?:data|records?|entries|content|show|list|read|query|remaining)\b/i
const mutationIntent = /删除|清空|移除|修改|改成|添加|新增|写入|导入|导出|发送给|上传|分享|\b(?:delete|remove|clear|update|edit|write|create|add|import|export|upload|share)\b/i
const builtinAliases: Record<string, string[]> = { diary: ['日记', 'journal'], ledger: ['记账', '账本', '收支'], contacts: ['通讯录'], album: ['相册', 'photos'], music: ['音乐'], divination: ['梅花易数', '占卜'] }
function aliases(manifest: Pick<AppDataManifest, 'id' | 'name' | 'english' | 'aliases'>): string[] {
  const catalog = extensionApps.find(app => app.id === manifest.id)
  const values = [manifest.name, manifest.english, manifest.id, ...(manifest.aliases || []), ...(builtinAliases[manifest.id] || []), ...(catalog ? [catalog.name, catalog.english] : [])]
  return [...new Set(values.flatMap(name => [name, name.replace(/(?:助手|记录|小应用|工具)$/, '')]).map(value => value.toLowerCase()).filter(value => value.length >= 2))]
}
function matchingApps(text: string, manifests: AppDataManifest[]): AppDataManifest[] {
  const normalized = text.toLowerCase()
  const matches = manifests.flatMap(manifest => {
    const found = aliases(manifest).map(alias => ({ alias, start: normalized.indexOf(alias) })).filter(item => item.start >= 0).sort((a, b) => b.alias.length - a.alias.length)[0]
    return found ? [{ manifest, start: found.start, end: found.start + found.alias.length }] : []
  })
  // Prefer the more specific named app if names overlap (护肤日记 is not ordinary 日记).
  return matches.filter(match => !matches.some(other => other !== match && other.start <= match.start && other.end >= match.end && other.end - other.start > match.end - match.start)).map(match => match.manifest).slice(0, 20)
}
function selectedScope(app: AppDataManifest, text: string): AppDataScope | undefined {
  const desired = [
    /正文|内容|写了什么|写过什么|\b(?:content|text)\b/i.test(text) ? 'text' : '',
    /备注|\bnotes?\b/i.test(text) ? 'note' : '',
    /电话|\bphone\b/i.test(text) ? 'phone' : '',
    /邮箱|\bemail\b/i.test(text) ? 'email' : '',
    /过敏|\ballerg/i.test(text) ? 'allergies' : '',
  ].filter(Boolean)
  return app.scopes.find(scope => desired.some(field => scope.fields.includes(field)))
    || app.scopes.find(scope => scope.name && text.includes(scope.name))
    || app.scopes.find(scope => !scope.sensitive)
    || app.scopes[0]
}
const dateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
function queryFor(text: string, calendar: boolean): AppDataQuery {
  const query: AppDataQuery = { text, limit: 20 }
  if (quantityIntent.test(text)) query.operation = 'count'
  else if (calendar && upcomingIntent.test(text) && !/过去|历史|此前|previous|past/i.test(text)) query.operation = 'upcoming'
  else if (recentIntent.test(text)) { query.operation = 'recent'; query.limit = 5 }
  else if (upcomingIntent.test(text)) query.operation = 'upcoming'
  const now = new Date(), year = now.getFullYear(), month = now.getMonth()
  if (query.operation === 'upcoming') { query.today = dateString(now); query.limit = 5 }
  if (/上个?月|last month/i.test(text)) { query.from = dateString(new Date(year, month - 1, 1)); query.to = dateString(new Date(year, month, 1)) }
  else if (/本月|这个月|this month/i.test(text)) { query.from = dateString(new Date(year, month, 1)); query.to = dateString(new Date(year, month + 1, 1)) }
  else if (/今天|today/i.test(text)) { query.from = dateString(now); query.to = dateString(new Date(year, month, now.getDate() + 1)) }
  return query
}
const fieldLabels: Record<string, [string, string]> = {
  nextDate: ['下一次日期', 'Next occurrence'], daysUntil: ['距今（天）', 'Days until'],
  name: ['名称', 'Name'], date: ['日期', 'Date'], yearly: ['每年重复', 'Repeat yearly'], text: ['正文', 'Text'], note: ['备注', 'Note'], notes: ['备注', 'Notes'], mood: ['心情', 'Mood'],
  category: ['分类', 'Category'], season: ['季节', 'Season'], color: ['颜色', 'Color'], phone: ['电话', 'Phone'], email: ['邮箱', 'Email'], count: ['记录数', 'Record count'],
  incomeCents: ['收入（分）', 'Income (cents)'], expenseCents: ['支出（分）', 'Expense (cents)'], balanceCents: ['结余（分）', 'Balance (cents)'], currency: ['币种', 'Currency'], snapshotCurrent: ['当前快照', 'Current snapshot'],
}
function fieldsText(fields: Record<string, string | number | boolean | null>, en: boolean): string {
  return Object.entries(fields).map(([key, value]) => `${fieldLabels[key]?.[en ? 1 : 0] || key}：${typeof value === 'boolean' ? (value ? (en ? 'Yes' : '是') : (en ? 'No' : '否')) : value === null ? (en ? 'Not specified' : '未填写') : value}`).join(en ? '; ' : '；')
}

/** The user's explicit named-App read request authorizes this local read only, NEVER model upload. */
export async function appDataLocalReply(text: string, identity: AppDataIdentity, locale: Locale, signal: AbortSignal): Promise<string | null> {
  if (text.length > 300 || !(readIntent.test(text) || quantityIntent.test(text) || recentIntent.test(text) || upcomingIntent.test(text)) || mutationIntent.test(text) || isInstalledAppsQuestion(text) || assessUserInput(text)) return null
  const en = locale === 'en'
  signal.throwIfAborted()
  let targets: AppDataManifest[] = []
  try {
    initializeAppDataProviders()
    const registered = listRegisteredAppDataManifests()
    // Include catalog-only Apps so an unavailable provider never falls through to invented model data.
    const candidates = [...registered, ...extensionApps.filter(app => !registered.some(item => item.id === app.id)).map(app => ({ id: app.id, name: app.name, english: app.english, availability: 'installable' as const, schemaVersion: 1, scopes: [] }))]
    targets = matchingApps(text, candidates)
    if (!targets.length) return null
    if (identity.temporary) return en ? '[Local reply]\nTemporary chat does not read saved App data. Ask the main Bot in regular chat.' : '【本机回复】\n临时会话不读取已保存的应用数据，请在主 Bot 的普通会话中查询。'
    if (identity.role !== identity.primaryId) return en ? '[Local reply]\nOnly the main Bot can read your saved App data.' : '【本机回复】\n只有主 Bot 可以读取你的应用记录，请切换到主 Bot。'
    const installed = new Set(extensionInstallationSnapshot().ids)
    const chunks = [en ? '[Local App read · not AI-generated · not uploaded]' : '【本机应用读取 · 非 AI 生成 · 未发送给模型】']
    const selected = targets.flatMap(app => {
      const name = en ? app.english : app.name
      if (app.availability === 'installable' && !installed.has(app.id)) { chunks.push(en ? `${name}: not installed in Aily; retained data will not be read.` : `${name}：当前未安装，不读取可能保留的旧数据。`); return [] }
      const scope = selectedScope(app, text)
      if (!scope) { chunks.push(en ? `${name}: no readable persistent-data interface yet.` : `${name}：当前没有可读取的持久业务数据接口。`); return [] }
      return [{ appId: app.id, scope: scope.id }]
    })
    if (selected.length) {
      const calendar = selected.some(selection => targets.find(app => app.id === selection.appId)?.scopes.find(scope => scope.id === selection.scope)?.calendar)
      const query = queryFor(text, calendar)
      // A local read does not require an API key, endpoint or model. This ephemeral
      // preview is never approved for external use and is discarded below.
      const localIdentity = { ...identity, endpoint: 'local-only://aily', model: 'local-read' }
      const preview = await previewAppData(selected, query, localIdentity, signal)
      try {
        signal.throwIfAborted()
        for (const view of preview.views) {
          const manifest = targets.find(app => app.id === view.appId)
          const scope = manifest?.scopes.find(item => item.id === view.scope)
          const countLabel = scope?.countLabel?.[en ? 'en' : 'zh'] || (en ? 'Record count' : '记录数量')
          chunks.push(`${en ? view.english : view.name} · ${scope ? (en ? scope.english : scope.name) : view.scope}`)
          if (query.operation === 'upcoming' && scope?.calendar) chunks.push(en ? 'Sorted by the next occurrence, nearest first. Yearly dates use the next valid month/day.' : '按下一次日期从近到远排列；每年重复的日期按下一个有效月日计算。')
          if (view.result.status === 'empty') {
            const schema = scope?.fields.filter(field => !['count', 'snapshotCurrent', 'nextDate', 'daysUntil'].includes(field)).map(field => fieldLabels[field]?.[en ? 1 : 0] || field).join(en ? ', ' : '、')
            if (query.operation === 'count') chunks.push(`${countLabel}：0`)
            chunks.push(query.operation === 'upcoming' && scope?.calendar ? (en ? 'No upcoming dates in the requested range.' : '当前范围内没有即将到来的日期。') : en ? `No saved records in this range.${schema ? ` Supported fields: ${schema}.` : ''}` : `当前范围内没有已保存记录。${schema ? `可保存/读取的字段包括：${schema}。` : ''}`)
          } else if (view.result.status !== 'ok') chunks.push(en ? 'Read unavailable or data format invalid; no records guessed.' : '读取不可用或数据格式异常，没有猜测或编造记录。')
          else if (query.operation === 'count') {
            const count = view.result.summary.count
            chunks.push(typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? `${countLabel}：${count}` : en ? 'This provider did not supply a complete count; no total was inferred from a partial page.' : '此接口未提供完整数量，不能把部分明细当作全部统计。')
          } else {
            if (query.operation === 'recent') chunks.push(en ? `Most recent saved records (up to ${query.limit}).` : `最近已保存的记录（最多 ${query.limit} 条）。`)
            if (Object.keys(view.result.summary).length) chunks.push(fieldsText(view.result.summary, en))
            view.result.records.forEach((record, index) => { if (Object.keys(record.fields).length) chunks.push(`${index + 1}. ${fieldsText(record.fields, en)}`) })
          }
          if (manifest?.dataBoundary) chunks.push(manifest.dataBoundary[en ? 'en' : 'zh'])
          if (view.result.truncated) chunks.push(en ? 'Some fields/records were truncated; open the App for the full records.' : '部分字段或记录已截断；完整记录请打开对应应用查看。')
          chunks.push(en ? `Read at: ${view.readAt}` : `读取时间：${new Date(view.readAt).toLocaleString('zh-CN')}`)
        }
        if (query.from || query.to) chunks.push(en ? `Dated records range: ${query.from} to ${query.to} (end excluded). Nondated settings are current snapshots.` : `有日期记录的范围：${query.from} 至 ${query.to}（不含结束当天）；无日期设置仍为当前快照。`)
      } finally { discardAppDataPreview(preview) }
    }
    chunks.push(en ? 'This result stays in local chat and is excluded from future AI context. For AI analysis, preview and authorize the selected data via “Read app data”.' : '以上结果仅保留在本机聊天，不进入后续 AI 上下文。如需 AI 分析，请在“读取应用数据”中预览并确认本次发送。')
    return chunks.join('\n\n')
  } catch (error) {
    signal.throwIfAborted()
    return en ? '[Local reply]\nApp records could not be read. Installation, permissions or data may have changed. Retry or open the App; no data was sent to the model.' : '【本机回复】\n应用记录未能读取，安装状态、权限或数据可能已变化。请重试或打开应用检查；没有将数据发送给模型。'
  }
}
