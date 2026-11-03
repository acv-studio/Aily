import { characters, type CharacterId } from './data'

export type OnboardingProfile = {
  characterId: CharacterId
  userName: string
  characterName: string
  familiarNames: boolean
  chatLength: 'short' | 'long'
  proactiveFrequency: 'off' | 'daily' | 'occasional'
  banter: boolean
  supportStyle: 'listen' | 'comfort'
  blockedTopics: string
  notificationStart: string
  notificationEnd: string
  adultEnabled: boolean
  ageConfirmed: boolean
  adultConsent: boolean
  safeWord: string
}

export function defaultOnboardingProfile(characterId: CharacterId): OnboardingProfile {
  return {
    characterId, userName: '你', characterName: characters.find(role => role.id === characterId)!.name,
    familiarNames: false, chatLength: 'short', proactiveFrequency: 'off', banter: false,
    supportStyle: 'listen', blockedTopics: '', notificationStart: '09:00', notificationEnd: '22:00',
    adultEnabled: false, ageConfirmed: false, adultConsent: false, safeWord: '停',
  }
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isRole = (value: unknown): value is CharacterId => characters.some(role => role.id === value)
const text = (value: unknown, max: number, required = false): value is string => typeof value === 'string' && value.length <= max && (!required || !!value.trim())
const clock = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)

/** Authorization is never inferred from a nickname, adult switch, or consent alone. */
export function adultAuthorizationAllowed(profile: OnboardingProfile | null | undefined): boolean {
  return profile?.adultEnabled === true && profile.ageConfirmed === true && profile.adultConsent === true && !!profile.safeWord.trim()
}

/** Strict validation for user-confirmed saves and optional backup fields. */
export function validateOnboardingProfile(value: unknown): OnboardingProfile {
  const fail = () => { throw new Error('引导设置无效：请检查称呼、偏好、通知时段及独立成年与同意确认') }
  if (!record(value) || !isRole(value.characterId)) return fail()
  const allowed = Object.keys(defaultOnboardingProfile(value.characterId))
  if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(value, key))) return fail()
  if (!text(value.userName, 80, true) || !text(value.characterName, 80, true) || !text(value.blockedTopics, 2000) || !text(value.safeWord, 80)) return fail()
  for (const key of ['familiarNames', 'banter', 'adultEnabled', 'ageConfirmed', 'adultConsent']) if (typeof value[key] !== 'boolean') return fail()
  if (!['short', 'long'].includes(value.chatLength as string) || !['off', 'daily', 'occasional'].includes(value.proactiveFrequency as string) || !['listen', 'comfort'].includes(value.supportStyle as string)) return fail()
  if (!clock(value.notificationStart) || !clock(value.notificationEnd)) return fail()
  const profile = { ...value, userName: value.userName.trim(), characterName: value.characterName.trim(), blockedTopics: value.blockedTopics.trim(), safeWord: value.safeWord.trim() } as OnboardingProfile
  if (profile.adultEnabled && !adultAuthorizationAllowed(profile)) return fail()
  return profile
}

/** Safe loading: unknown roles return null; missing/malformed fields use safe defaults. */
export function normalizeOnboardingProfile(value: unknown): OnboardingProfile | null {
  if (!record(value) || !isRole(value.characterId)) return null
  const profile = defaultOnboardingProfile(value.characterId)
  for (const key of ['userName', 'characterName'] as const) if (text(value[key], 80, true)) profile[key] = value[key].trim()
  if (text(value.blockedTopics, 2000)) profile.blockedTopics = value.blockedTopics.trim()
  if (text(value.safeWord, 80)) profile.safeWord = value.safeWord.trim()
  for (const key of ['familiarNames', 'banter', 'adultEnabled', 'ageConfirmed', 'adultConsent'] as const) profile[key] = value[key] === true
  if (value.chatLength === 'short' || value.chatLength === 'long') profile.chatLength = value.chatLength
  if (value.proactiveFrequency === 'off' || value.proactiveFrequency === 'daily' || value.proactiveFrequency === 'occasional') profile.proactiveFrequency = value.proactiveFrequency
  if (value.supportStyle === 'listen' || value.supportStyle === 'comfort') profile.supportStyle = value.supportStyle
  for (const key of ['notificationStart', 'notificationEnd'] as const) if (clock(value[key])) profile[key] = value[key]
  // A missing/malformed safe word must not be silently repaired into authorization.
  if (!text(value.safeWord, 80, true) || !adultAuthorizationAllowed(profile)) profile.adultEnabled = false
  return profile
}

/** Backups carry preferences, never transferable adult authorization. */
export function withoutAdultAuthorization(profile: OnboardingProfile): OnboardingProfile {
  return { ...profile, adultEnabled: false, ageConfirmed: false, adultConsent: false }
}

export const onboardingMemoryId = (id: CharacterId) => `onboarding:relationship:${id}`
export function onboardingMemoryText(profile: OnboardingProfile): string {
  return `第一次确认彼此的称呼：${JSON.stringify({ userName: profile.userName, characterName: profile.characterName, familiarNames: profile.familiarNames })}。称呼之后可随时修改，不代表关系降级。`
}
