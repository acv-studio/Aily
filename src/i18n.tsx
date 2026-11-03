import { useSyncExternalStore } from 'react'
import { appEnglish, englishSingular } from './locales/appEnglish'
import { panelEnglish } from './locales/panels'
import { chatEnglish } from './locales/chatEnglish'
import { onboardingEnglish } from './locales/onboardingEnglish'
import { storyEnglish } from './locales/storyEnglish'
import { privacyEnglish } from './locales/privacyEnglish'
import { splashEnglish } from './locales/splashEnglish'
import { sharingEnglish } from './locales/sharingEnglish'

export type Locale = 'zh-CN' | 'en'
export type ChatLocale = Locale | 'auto'
export type TranslationParams = Record<string, string | number>
export const english: Record<string, string> = { ...appEnglish, ...panelEnglish, ...chatEnglish, ...onboardingEnglish, ...storyEnglish, ...privacyEnglish, ...splashEnglish, ...sharingEnglish }
const listeners = new Set<() => void>()
const isLocale = (value: unknown): value is Locale => value === 'zh-CN' || value === 'en'
function stored(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null } catch { return null }
}
function systemLocale(): Locale {
  return typeof navigator !== 'undefined' && /^en\b/i.test(navigator.language) ? 'en' : 'zh-CN'
}
let locale: Locale = isLocale(stored('aily.locale')) ? stored('aily.locale') as Locale : systemLocale()
let chatLocale: ChatLocale = isLocale(stored('aily.chatLocale')) ? stored('aily.chatLocale') as Locale : 'auto'
function publish() {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
    document.title = translate('Aily · 记得你的每一天', {}, locale)
  }
  listeners.forEach(listener => listener())
}
export function getLocale(): Locale { return locale }
export function getChatLocale(): ChatLocale { return chatLocale }
export function setLocale(value: Locale) {
  if (!isLocale(value)) return
  locale = value
  try { globalThis.localStorage?.setItem('aily.locale', value) } catch { /* still usable in memory */ }
  publish()
}
export function setChatLocale(value: ChatLocale) {
  if (value !== 'auto' && !isLocale(value)) return
  chatLocale = value
  try { globalThis.localStorage?.setItem('aily.chatLocale', value) } catch { /* still usable in memory */ }
  publish()
}
export function detectLanguage(text: string): Locale | 'mixed' | undefined {
  const chinese = /[\u3400-\u9fff]/u.test(text), latin = /[a-z]/i.test(text)
  return chinese && latin ? 'mixed' : chinese ? 'zh-CN' : latin ? 'en' : undefined
}
export function resolveChatLocale(text: string, preference: ChatLocale = chatLocale): Locale {
  if (preference !== 'auto') return preference
  const language = detectLanguage(text)
  if (language && language !== 'mixed') return language
  if (language === 'mixed') {
    const chinese = text.match(/[\u3400-\u9fff]/gu)?.length || 0
    const words = text.match(/[a-z]+/gi)?.length || 0
    return words > chinese ? 'en' : 'zh-CN'
  }
  return locale
}
export function translate(key: string, params: TranslationParams = {}, language: Locale = locale): string {
  const template = language === 'en' ? (Number(params.count) === 1 ? englishSingular[key] : undefined) ?? english[key] ?? key : key
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] === undefined ? match : String(params[name]))
}
export function t(key: string, params?: TranslationParams): string { return translate(key, params) }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useI18n() {
  useSyncExternalStore(subscribe, () => `${locale}:${chatLocale}`, () => 'zh-CN:auto')
  return { t, locale, setLocale, chatLocale, setChatLocale }
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === 'aily.locale') locale = isLocale(stored('aily.locale')) ? stored('aily.locale') as Locale : systemLocale()
    if (event.key === null || event.key === 'aily.chatLocale') chatLocale = isLocale(stored('aily.chatLocale')) ? stored('aily.chatLocale') as Locale : 'auto'
    if (event.key === null || event.key === 'aily.locale' || event.key === 'aily.chatLocale') publish()
  })
  publish()
}
