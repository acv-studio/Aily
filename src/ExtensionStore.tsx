import { useEffect, useId, useRef, useState } from 'react'
import './extensionStore.css'
import { ArrowLeft, Download, PackageCheck, Pause, Play, RotateCcw, Trash2 } from 'lucide-react'
import { extensionApps, installedExtensionIds, setExtensionInstalled, type ExtensionApp, type ExtensionAppId } from './extensionApps'
import { AnniversaryApp, Game2048, GomokuApp, SkincareApp, WardrobeApp } from './ExtensionAppViews'
import type { Locale } from './i18n'
import MealPlannerApp from './MealPlannerApp'
import LaughterCollectorApp from './LaughterCollectorApp'
import PhotoOrganizerApp from './PhotoOrganizerApp'
import FeedbackApp from './FeedbackApp'
import { getRegisteredMiniAppComponent } from './extensionRuntime'

type StoreFilter = 'all' | 'life' | 'game' | 'installed'
export default function ExtensionStore({ locale, openApp }: { locale: Locale; openApp?: (id: ExtensionAppId) => void }) {
  const en = locale === 'en', copy = (zh: string, english: string) => en ? english : zh
  const [installed, setInstalled] = useState(installedExtensionIds)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<StoreFilter>('all')
  const [detailId, setDetailId] = useState<ExtensionAppId | null>(null)
  const [pending, setPending] = useState<ExtensionAppId | null>(null), [error, setError] = useState(''), [status, setStatus] = useState('')
  const heading = useRef<HTMLHeadingElement>(null), browseTrigger = useRef<HTMLButtonElement | null>(null), cancelButton = useRef<HTMLButtonElement>(null)
  const browseTriggerId = useRef<ExtensionAppId | null>(null)
  const confirmId = useId()
  useEffect(() => {
    const sync = () => setInstalled(installedExtensionIds())
    const storage = (event: StorageEvent) => { if (event.key === 'aily.extension-apps.v1' || event.key === null) sync() }
    window.addEventListener('aily-extension-apps', sync); window.addEventListener('storage', storage)
    return () => { window.removeEventListener('aily-extension-apps', sync); window.removeEventListener('storage', storage) }
  }, [])
  useEffect(() => { if (detailId) heading.current?.focus(); else if (browseTrigger.current?.isConnected) browseTrigger.current.focus() }, [detailId])
  useEffect(() => { if (pending) cancelButton.current?.focus() }, [pending])
  const name = (app: ExtensionApp) => en ? app.english : app.name
  const toggle = (id: ExtensionAppId, value: boolean) => {
    try {
      setInstalled(setExtensionInstalled(id, value)); setPending(null); setError('')
      const app = extensionApps.find(item => item.id === id)!
      setStatus(value ? copy(`已安装 ${name(app)}`, `${name(app)} installed`) : copy(`已卸载 ${name(app)}，应用数据已保留。`, `${name(app)} uninstalled. App data has been kept.`))
    } catch { setError(copy('操作失败，请检查本机存储权限或剩余空间。原安装状态未更改。', 'Could not update installation. Check local storage permissions or available space. Installation state is unchanged.')) }
  }
  const actions = (app: ExtensionApp) => {
    const active = installed.includes(app.id)
    return <div className="store-app-actions">{active && openApp && <button type="button" aria-label={`${copy('打开', 'Open')} ${name(app)}`} onClick={() => openApp(app.id)}><PackageCheck size={16}/>{copy('打开', 'Open')}</button>}
      <button type="button" className={active ? 'store-remove' : 'store-install'} aria-label={`${active ? copy('卸载', 'Uninstall') : copy('安装', 'Install')} ${name(app)}`} onClick={() => { setError(''); if (active) setPending(app.id); else toggle(app.id, true) }}>{active ? <Trash2 size={16}/> : <Download size={16}/>} {active ? copy('卸载', 'Uninstall') : copy('安装', 'Install')}</button></div>
  }
  const detail = extensionApps.find(app => app.id === detailId)
  const pendingApp = extensionApps.find(app => app.id === pending)
  const needle = query.trim().toLocaleLowerCase()
  const matches = extensionApps.filter(app => (filter === 'all' || (filter === 'installed' ? installed.includes(app.id) : app.category === filter)) && [app.name, app.english, app.description, app.englishDescription].some(text => text.toLocaleLowerCase().includes(needle)))
  const filters: [StoreFilter, string][] = [['all', copy('全部', 'All')], ['life', copy('生活应用', 'Lifestyle')], ['game', copy('游戏', 'Games')], ['installed', copy(`已安装 (${installed.length})`, `Installed (${installed.length})`)]]
  return <section className="aily-extension-store" aria-label={copy('应用商店目录', 'App Store catalog')}>
    {detail ? <><button className="store-back" type="button" onClick={() => { setDetailId(null); setPending(null); setError('') }}><ArrowLeft size={18}/>{copy('返回应用列表', 'Back to apps')}</button>
      <article className="store-detail"><span className="store-app-icon" aria-hidden="true" style={{ backgroundColor: detail.color }}>{detail.icon}</span><h3 ref={heading} tabIndex={-1}>{name(detail)}</h3><p>{en ? detail.englishDescription : detail.description}</p><p className="store-muted">{detail.category === 'game' ? copy('游戏', 'Games') : copy('生活应用', 'Lifestyle')} · {installed.includes(detail.id) ? copy('已安装', 'Installed') : copy('未安装', 'Not installed')}</p>{actions(detail)}
        <div className="store-detail-info"><h4>{copy('关于此应用', 'About this app')}</h4><p>{copy('这是 Aily 内置的小应用。安装后会添加到你的应用列表；不需要从外部商店下载。', 'This is a mini app bundled with Aily. Installing adds it to your app list; no external store download is required.')}</p><h4>{copy('存储与卸载', 'Storage and removal')}</h4><p>{copy('安装状态仅保存在当前浏览器。卸载只移除应用入口，不会删除已有应用数据；重新安装可再次使用。清除浏览器数据可能移除本机记录。', 'Installation state stays in this browser. Uninstall removes the app entry, not existing app data; reinstall to use it again. Clearing browser data may remove local records.')}</p></div>
      </article></> : <><p className="store-muted">{copy('探索 Aily 内置小应用，按需添加到桌面。安装状态与应用记录仅保存在当前浏览器。', 'Explore mini apps bundled with Aily and add them to your desktop. Installation state and app records stay in this browser.')}</p>
      <label className="store-search">{copy('搜索应用', 'Search apps')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={copy('名称或功能', 'Name or feature')} /></label>
      <nav className="store-filters" aria-label={copy('应用筛选', 'App filters')}>{filters.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPending(null) }}>{label}</button>)}</nav>
      <p className="store-muted">{copy(`${matches.length} 个应用`, `${matches.length} apps`)}</p><div className="store-app-grid">{matches.map(app => <article className="store-app-card" key={app.id}>
        <span className="store-app-icon" aria-hidden="true" style={{ backgroundColor: app.color }}>{app.icon}</span><div className="store-app-copy"><h3>{name(app)}</h3><p>{en ? app.englishDescription : app.description}</p>{installed.includes(app.id) && <small className="store-installed-label">{copy('已安装', 'Installed')}</small>}</div>
        <div className="store-card-controls"><button ref={node => { if (browseTriggerId.current === app.id) browseTrigger.current = node }} type="button" className="store-details-button" aria-label={`${copy('查看详情', 'View details')}: ${name(app)}`} onClick={event => { browseTriggerId.current = app.id; browseTrigger.current = event.currentTarget; setDetailId(app.id); setPending(null); setError('') }}>{copy('查看详情', 'View details')}</button>{actions(app)}</div>
      </article>)}</div>{!matches.length && <p className="store-empty">{filter === 'installed' && !query ? copy('还没有安装应用。选择“全部”来浏览和安装。', 'No apps installed yet. Choose All to browse and install.') : copy('没有匹配的应用，请更换搜索词或筛选。', 'No matching apps. Try another search or filter.')}</p>}</>}
    {pendingApp && <section className="store-confirm" role="alertdialog" aria-labelledby={confirmId} aria-describedby={`${confirmId}-description`}><h4 id={confirmId}>{copy(`卸载 ${name(pendingApp)}？`, `Uninstall ${name(pendingApp)}?`)}</h4><p id={`${confirmId}-description`}>{copy('这会移除应用入口，但保留应用数据。可以随时重新安装。', 'This removes the app entry but keeps its data. You can reinstall at any time.')}</p><div className="store-app-actions"><button ref={cancelButton} type="button" onClick={() => { setPending(null); setError('') }}>{copy('取消', 'Cancel')}</button><button type="button" onClick={() => toggle(pendingApp.id, false)}>{copy('确认卸载', 'Confirm uninstall')}</button></div></section>}
    {error && <p className="store-error" role="alert">{error}</p>}<p className="store-status" role="status">{status}</p>
  </section>
}

export function ExtensionAppView({id,locale}:{id:ExtensionAppId;locale:Locale}){const RegisteredApp=getRegisteredMiniAppComponent(id);if(RegisteredApp)return <RegisteredApp locale={locale}/>;if(id==='feedback')return <FeedbackApp locale={locale}/>;if(id==='photo-organizer')return <PhotoOrganizerApp locale={locale}/>;if(id==='laughter-collector')return <LaughterCollectorApp locale={locale}/>;if(id==='meal-planner')return <MealPlannerApp locale={locale}/>;if(id==='focus-timer')return <FocusTimer locale={locale}/>;if(id==='skincare-diary')return <SkincareApp locale={locale}/>;if(id==='wardrobe')return <WardrobeApp locale={locale}/>;if(id==='anniversary')return <AnniversaryApp locale={locale}/>;if(id==='gomoku')return <GomokuApp locale={locale}/>;if(id==='game-2048')return <Game2048/>;return <p role="status">{locale==='en'?'App temporarily unavailable':'应用暂不可用'}</p>}
function FocusTimer({locale}:{locale:Locale}){const en=locale==='en';const [seconds,setSeconds]=useState(25*60),[running,setRunning]=useState(false);useEffect(()=>{if(!running)return;const timer=window.setInterval(()=>setSeconds(value=>{if(value<=1){setRunning(false);return 0}return value-1}),1000);return()=>clearInterval(timer)},[running]);return <div className="extension-functional focus-extension"><div className="focus-dial"><time>{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</time><small>{en?'Focus session':'专注时间'}</small></div><div className="extension-functional-actions"><button onClick={()=>setRunning(v=>!v)}>{running?<><Pause/> {en?'Pause':'暂停'}</>:<><Play/> {en?'Start':'开始'}</>}</button><button onClick={()=>{setRunning(false);setSeconds(1500)}}><RotateCcw/> {en?'Reset':'重置'}</button></div><div className="focus-presets">{[15,25,45].map(m=><button key={m} onClick={()=>{setRunning(false);setSeconds(m*60)}}>{m} min</button>)}</div></div>}
