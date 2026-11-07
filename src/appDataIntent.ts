import type { Locale } from './i18n'
import type { AppDataIdentity } from './appDataTypes'
import { BUILTIN_APP_IDS, extensionApps, extensionInstallationSnapshot } from './extensionApps'

/** Installation metadata is answered locally, never inferred from the conversation or an LLM. */
export function isInstalledAppsQuestion(text: string): boolean {
  if (text.length > 160) return false
  const clean = text.trim().toLowerCase().replace(/[？?。.!！,，:：;；]/g, '').replace(/\s+/g, ' ')
  const zh = clean.replace(/\s/g, '').replace(/^(?:请)?(?:帮我|告诉我|查看|查询|查一下|看看|列出|列一下|说说)?/, '')
  const subject = '(?:我(?:现在|当前)?(?:在aily(?:里|中)?)?|aily(?:里|中)?|当前|本机)?'
  const noun = '(?:软件|应用|小应用|apps?)'
  return new RegExp(`^${subject}(?:已经|已|都)?(?:安装了|装了|安装过|装过|安装|装)(?:的)?(?:哪些|什么|哪几个|几个|多少)${noun}(?:吗|呢|呀)?$`).test(zh)
    || new RegExp(`^${subject}(?:有哪些|有什么|有啥)${noun}(?:吗|呢|呀)?$`).test(zh)
    || new RegExp(`^${subject}(?:已安装|安装过|安装了|安装的)(?:的)?${noun}(?:列表|清单|有哪些|是什么|有多少)?$`).test(zh)
    || /^(?:what|which) (?:apps|applications|software) (?:have i installed|did i install|are installed(?: in aily)?)$/.test(clean)
    || /^(?:please )?(?:list|show|show me|tell me)(?: all)?(?: my| the)? (?:installed apps|installed applications|installed software|apps i(?: have)? installed)$/.test(clean)
}
const builtinNames: Record<string, [string, string]> = {
  ledger: ['记账', 'Ledger'], contacts: ['通讯录', 'Contacts'], diary: ['日记', 'Journal'],
  album: ['相册', 'Photos'], music: ['音乐', 'Music'], 'app-store': ['应用商店', 'App Store'], divination: ['梅花易数', 'Meihua Divination'],
}
export function installedAppsLocalReply(text: string, identity: AppDataIdentity, locale: Locale): string | null {
  if (!isInstalledAppsQuestion(text)) return null
  const en = locale === 'en'
  if (identity.temporary) return en ? '[Local reply]\nTemporary chat does not read your installation list. Ask the main Bot in regular chat.' : '【本机回复】\n临时会话不会读取你的安装清单，请在主 Bot 的普通会话中查询。'
  if (identity.role !== identity.primaryId) return en ? '[Local reply]\nOnly your main Bot can read the Aily app installation list. Please switch to the main Bot.' : '【本机回复】\n应用安装清单只由主 Bot 读取，请切换到主 Bot 后再问我。'
  try {
    const snapshot = extensionInstallationSnapshot()
    const installed = snapshot.ids.map(id => extensionApps.find(app => app.id === id)!)
    const list = installed.map((app, index) => `${index + 1}. ${en ? app.english : app.name}`).join('\n')
    const builtins = BUILTIN_APP_IDS.map(id => builtinNames[id]?.[en ? 1 : 0] ?? id).join(en ? ', ' : '、')
    if (en) return `[Local installation list · not AI-generated]\n${installed.length ? `You have ${installed.length} mini-apps installed in Aily:\n${list}` : 'You have not installed any optional Aily mini-apps yet.'}\n\nAlways-available tools (not counted as installations): ${builtins}.\n\nThis is Aily’s current installation list, not every third-party app on your phone. Ask a named App for an on-device record read. For AI analysis, use “Read app data” and review/authorize the selected fields.`
    return `【本机安装清单 · 非 AI 生成】\n${installed.length ? `你在 Aily 里安装了 ${installed.length} 个小应用：\n${list}` : '你目前还没有安装可选的 Aily 小应用。'}\n\n另有常驻工具（不计入安装数量）：${builtins}。\n\n这是当前 Aily 的安装清单，不是手机上所有第三方软件。可直接点名查询某个应用的本机记录；如需 AI 分析，请使用“读取应用数据”，选择范围并预览授权。`
  } catch {
    return en ? '[Local reply]\nThe installation list could not be read or is invalid. I cannot confirm which apps are installed. Please check App Store/storage and retry; I will not guess from chat history.' : '【本机回复】\n安装清单读取失败或格式异常，暂时无法确认你安装了哪些应用。请检查应用商店或本机存储后重试；我不会根据聊天历史猜测。'
  }
}
