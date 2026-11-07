export type ExtensionAppId = string
/** Permanent host tool ids are reserved even before their data providers initialize. */
export const BUILTIN_APP_IDS: readonly string[] = Object.freeze(['ledger', 'contacts', 'diary', 'album', 'music', 'app-store', 'divination'])
export function isReservedBuiltinAppId(id: string): boolean { return BUILTIN_APP_IDS.includes(id) }
export function isSafeExtensionAppId(id: unknown): id is string { return typeof id === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) && id.length <= 80 && !['constructor', 'prototype', '__proto__'].includes(id) }
export type ExtensionApp = { id:ExtensionAppId; name:string; english:string; description:string; englishDescription:string; icon:string; color:string; category:'life'|'game' }
export const extensionApps:ExtensionApp[]=[
 {id:'feedback',name:'反馈',english:'Feedback',description:'写下建议、吐槽或感谢，通过系统邮件发送给 Aily，默认安装',englishDescription:'Share suggestions, complaints or thanks by email; installed by default',icon:'💌',color:'#c9b7e8',category:'life'},
 {id:'photo-organizer',name:'相册整理',english:'Photo Organizer',description:'随机翻看本地照片，上滑待删除、下滑保留，左右浏览，随时撤销',englishDescription:'Review local photos randomly: swipe up to flag, down to keep, sideways to browse, and undo anytime',icon:'🖼️',color:'#a8cbb7',category:'life'},
 {id:'laughter-collector',name:'笑声收集器',english:'Laughter Collector',description:'按人物录下笑声，本机保存、多段剪辑与导出，留住开心的瞬间',englishDescription:'Record laughter by person, save locally, edit multiple segments and export joyful moments',icon:'😆',color:'#f4bd75',category:'life'},
 {id:'meal-planner',name:'吃什么',english:'What to Eat',description:'按人数与口味选餐，用冰箱库存和预算买菜，接着备菜、做菜和分配洗碗',englishDescription:'Plan meals for your household, shop from pantry gaps and budget, cook and share cleanup',icon:'🍳',color:'#eca76e',category:'life'},
 {id:'focus-timer',name:'专注时钟',english:'Focus Timer',description:'简单的专注与休息计时工具',englishDescription:'A simple focus and break timer',icon:'⏱',color:'#ffb38f',category:'life'},
 {id:'skincare-diary',name:'护肤日记',english:'Skincare Diary',description:'记录护肤步骤、产品和肌肤状态',englishDescription:'Track routines, products and skin condition',icon:'🫧',color:'#f5a9c7',category:'life'},
 {id:'wardrobe',name:'穿搭衣橱',english:'Wardrobe',description:'整理衣物并组合每日穿搭',englishDescription:'Organize clothes and create outfits',icon:'👗',color:'#c8b2ff',category:'life'},
 {id:'anniversary',name:'纪念日助手',english:'Anniversary',description:'记录重要日期并查看倒数',englishDescription:'Save important dates and countdowns',icon:'💝',color:'#ff9da8',category:'life'},
 {id:'gomoku',name:'五子棋',english:'Gomoku',description:'电脑自动落子的人机对战，也支持本机双人模式',englishDescription:'Play an automatic offline opponent or local two-player Gomoku',icon:'⚫',color:'#e6c38c',category:'game'},
 {id:'game-2048',name:'2048',english:'2048',description:'滑动合并数字方块',englishDescription:'Swipe and merge number tiles',icon:'🔢',color:'#e5a76f',category:'game'},
]
export const extensionInstallationKey = 'aily.extension-apps.v1'
const incarnationKey = 'aily.extension-apps.incarnation.v1'
let incarnation = 0
const listeners = new Set<() => void>()
function changed() { incarnation++; for (const listener of listeners) listener() }
if (typeof window !== 'undefined') {
  window.addEventListener('aily-extension-apps', changed)
  window.addEventListener('storage', event => { if (event.key === extensionInstallationKey || event.key === incarnationKey || event.key === null) changed() })
}
export function subscribeExtensionAppChanges(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
function emitChange() { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('aily-extension-apps')); else changed() }
/** Strict access never interprets corrupt/unknown installation data as an empty install list. */
export function extensionInstallationSnapshot(): { ids: string[]; revision: string } {
  const raw = localStorage.getItem(extensionInstallationKey)
  const value: unknown = raw === null ? [] : JSON.parse(raw)
  if (!Array.isArray(value) || value.some(id => !isSafeExtensionAppId(id) || !extensionApps.some(app => app.id === id)) || new Set(value).size !== value.length) throw new Error('Invalid extension installation data')
  return { ids: value as string[], revision: JSON.stringify([raw, localStorage.getItem(incarnationKey), incarnation]) }
}
export function installedExtensionIds(): ExtensionAppId[] { try { const value = JSON.parse(localStorage.getItem(extensionInstallationKey) || '[]'); return Array.isArray(value) ? value.filter(id => extensionApps.some(app => app.id === id)) : [] } catch { return [] } }
export function setExtensionInstalled(id: ExtensionAppId, installed: boolean) {
  if (!isSafeExtensionAppId(id) || !extensionApps.some(app => app.id === id) || typeof installed !== 'boolean') throw new Error('Unknown extension app')
  const current = extensionInstallationSnapshot().ids
  const next = installed ? [...new Set([...current, id])] : current.filter(item => item !== id)
  // A separate persisted incarnation invalidates capabilities even after uninstall + reinstall restores the exact old raw list.
  localStorage.setItem(incarnationKey, `${Date.now()}:${Math.random()}:${++incarnation}`)
  localStorage.setItem(extensionInstallationKey, JSON.stringify(next))
  emitChange()
  return next
}
export function registerExtensionApp(app: ExtensionApp): () => void {
  if (!app || !isSafeExtensionAppId(app.id) || isReservedBuiltinAppId(app.id) || extensionApps.some(item => item.id === app.id)) throw new Error('Invalid or duplicate extension app')
  if (!['life', 'game'].includes(app.category) || ['name', 'english', 'description', 'englishDescription', 'icon', 'color'].some(key => typeof app[key as keyof ExtensionApp] !== 'string')) throw new Error('Invalid extension metadata')
  const captured = Object.freeze({ ...app })
  extensionApps.push(captured)
  emitChange()
  let active = true
  return () => {
    if (!active) return
    active = false
    try {
      if (installedExtensionIds().includes(captured.id)) setExtensionInstalled(captured.id, false)
    } finally {
      // Even denied/corrupt installation writes must not leave an unregistered runtime in the catalog.
      const index = extensionApps.indexOf(captured)
      if (index >= 0) extensionApps.splice(index, 1)
      emitChange()
    }
  }
}
