import { useEffect, useState } from 'react'
import { useI18n } from './i18n'

export default function ClockWidget() {
  const { locale } = useI18n()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const update = () => setNow(new Date())
    const timer = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update) }
  }, [])
  return <section className="clock-widget glass" aria-label={locale === 'en' ? 'Device time' : '系统时间'}>
    <time dateTime={now.toISOString()}>{now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
    <p>{now.toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'long' })}</p>
    <small>{locale === 'en' ? 'Synced with your device' : '与设备时间同步'}</small>
  </section>
}
