export type ExtensionAppId = 'focus-timer' | 'quick-notes' | 'habit-check'
export type ExtensionApp = { id: ExtensionAppId; name: string; english: string; description: string; englishDescription: string; icon: string; color: string }
export const extensionApps: ExtensionApp[] = [
  { id:'focus-timer',name:'专注时钟',english:'Focus Timer',description:'简单的专注与休息计时工具',englishDescription:'A simple focus and break timer',icon:'⏱',color:'#ffb38f' },
  { id:'quick-notes',name:'随手记',english:'Quick Notes',description:'快速记录只保存在本机的便签',englishDescription:'Quick notes saved only on this device',icon:'📝',color:'#9ed8ff' },
  { id:'habit-check',name:'习惯打卡',english:'Habit Check',description:'创建每日习惯并记录完成状态',englishDescription:'Create daily habits and track completion',icon:'✓',color:'#9ee7c6' },
]
const key='aily.extension-apps.v1'
export function installedExtensionIds():ExtensionAppId[]{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(id=>extensionApps.some(app=>app.id===id)):[]}catch{return[]}}
export function setExtensionInstalled(id:ExtensionAppId,installed:boolean){const current=installedExtensionIds();const next=installed?[...new Set([...current,id])]:current.filter(item=>item!==id);localStorage.setItem(key,JSON.stringify(next));window.dispatchEvent(new CustomEvent('aily-extension-apps'));return next}
