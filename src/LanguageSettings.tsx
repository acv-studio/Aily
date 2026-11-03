import { useI18n, type Locale, type ChatLocale } from './i18n'
import './i18n.css'

export default function LanguageSettings({ compact = false }: { compact?: boolean }) {
  const { t, locale, setLocale, chatLocale, setChatLocale } = useI18n()
  return <section className={`language-settings ${compact ? 'compact' : 'glass'}`} aria-label={t('语言设置')}>
    <label>{compact ? '中文 / English' : t('界面语言 / Interface language')}
      <select aria-label="界面语言 / Interface language" value={locale} onChange={event => setLocale(event.target.value as Locale)}>
        <option value="zh-CN" lang="zh-CN">简体中文</option><option value="en" lang="en">English</option>
      </select>
    </label>
    {!compact && <><label>{t('聊天语言')}
      <select aria-label={t('聊天语言')} value={chatLocale} onChange={event => setChatLocale(event.target.value as ChatLocale)}>
        <option value="auto">{t('跟随用户输入')}</option><option value="zh-CN" lang="zh-CN">简体中文</option><option value="en" lang="en">English</option>
      </select>
    </label><p>{t('切换语言不会改变聊天、回忆或角色关系。')}</p></>}
  </section>
}
