import { describe, expect, it } from 'vitest'
import { adultAuthorizationAllowed, defaultOnboardingProfile, normalizeOnboardingProfile, validateOnboardingProfile, withoutAdultAuthorization } from './onboarding'

describe('onboarding profiles', () => {
  it('uses safe skippable defaults for all three roles', () => {
    for (const id of ['lu', 'chen', 'gu'] as const) {
      const profile = defaultOnboardingProfile(id)
      expect(validateOnboardingProfile(profile)).toEqual(profile)
      expect(profile.adultEnabled).toBe(false)
      expect(profile.ageConfirmed).toBe(false)
      expect(profile.adultConsent).toBe(false)
      expect(profile.safeWord).toBe('停')
      expect(adultAuthorizationAllowed(profile)).toBe(false)
    }
  })
  it('loads partial profiles safely without coercing consent or retaining unknown fields', () => {
    expect(normalizeOnboardingProfile({ characterId: 'gu', userName: '  小雨 ', adultEnabled: true, ageConfirmed: 'true', adultConsent: true, apiKey: 'secret' })).toEqual({ ...defaultOnboardingProfile('gu'), userName: '小雨', adultConsent: true })
    for (const value of [null, [], {}, { characterId: 'other' }]) expect(normalizeOnboardingProfile(value)).toBeNull()
    expect(normalizeOnboardingProfile({ ...defaultOnboardingProfile('lu'), chatLength: 'huge', notificationStart: '25:10', banter: 'false' })).toEqual(defaultOnboardingProfile('lu'))
  })
  it.each(['ageConfirmed', 'adultConsent', 'safeWord'] as const)('requires independent %s to enable adults', key => {
    const valid = { ...defaultOnboardingProfile('lu'), adultEnabled: true, ageConfirmed: true, adultConsent: true }
    expect(adultAuthorizationAllowed(validateOnboardingProfile(valid))).toBe(true)
    const invalid = { ...valid, [key]: key === 'safeWord' ? '  ' : false }
    expect(() => validateOnboardingProfile(invalid)).toThrow('引导设置无效')
    expect(normalizeOnboardingProfile(invalid)?.adultEnabled).toBe(false)
    const missing = { ...valid } as Record<string, unknown>; delete missing[key]
    expect(normalizeOnboardingProfile(missing)?.adultEnabled).toBe(false)
  })
  it('strictly rejects malformed profiles before saves', () => {
    const profile = defaultOnboardingProfile('chen')
    for (const patch of [{ userName: '' }, { characterName: 'x'.repeat(81) }, { notificationEnd: '22:99' }, { proactiveFrequency: 'hourly' }, { ageConfirmed: 1 }, { extra: true }]) expect(() => validateOnboardingProfile({ ...profile, ...patch })).toThrow()
    expect(validateOnboardingProfile({ ...profile, userName: ' 雨 ', characterName: ' 阿奕 ' })).toMatchObject({ userName: '雨', characterName: '阿奕' })
  })
  it('accepts legacy profiles and defaults to independent empty exclusive names', () => {
    const legacy = { ...defaultOnboardingProfile('lu') }
    delete legacy.exclusiveNames
    expect(validateOnboardingProfile(legacy).exclusiveNames).toEqual({})
    expect(normalizeOnboardingProfile(legacy)?.exclusiveNames).toEqual({})
    const first = defaultOnboardingProfile('lu')
    first.exclusiveNames!.lu = '阿澜'
    expect(defaultOnboardingProfile('lu').exclusiveNames).toEqual({})
    expect(() => validateOnboardingProfile({ characterId: 'lu', exclusiveNames: {} })).toThrow()
  })
  it('validates and trims role-specific exclusive names without mutating input', () => {
    const profile = { ...defaultOnboardingProfile('lu'), exclusiveNames: { lu: ' 阿澜 ', chen: ' 阿奕 ', gu: 'x'.repeat(80) } }
    expect(validateOnboardingProfile(profile).exclusiveNames).toEqual({ lu: '阿澜', chen: '阿奕', gu: 'x'.repeat(80) })
    expect(profile.exclusiveNames.lu).toBe(' 阿澜 ')
    for (const exclusiveNames of [undefined, null, [], '阿澜', { other: '昵称' }, { lu: '' }, { lu: '  ' }, { lu: 'x'.repeat(81) }, { lu: 1 }, { lu: undefined }]) {
      expect(() => validateOnboardingProfile({ ...profile, exclusiveNames })).toThrow('引导设置无效')
    }
  })
  it('normalizes only valid per-role names and preserves them in authorization-free backups', () => {
    expect(normalizeOnboardingProfile({ ...defaultOnboardingProfile('chen'), exclusiveNames: { lu: ' 阿澜 ', chen: ' ', gu: 'x'.repeat(81), other: 'unknown' } })?.exclusiveNames).toEqual({ lu: '阿澜' })
    for (const exclusiveNames of [null, [], false, 'nickname']) {
      expect(normalizeOnboardingProfile({ ...defaultOnboardingProfile('lu'), exclusiveNames })?.exclusiveNames).toEqual({})
    }
    const profile = validateOnboardingProfile({ ...defaultOnboardingProfile('gu'), exclusiveNames: { lu: '阿澜', gu: '阿辰' }, adultEnabled: true, ageConfirmed: true, adultConsent: true })
    const backup = JSON.parse(JSON.stringify(withoutAdultAuthorization(profile)))
    expect(validateOnboardingProfile(backup).exclusiveNames).toEqual(profile.exclusiveNames)
    expect(adultAuthorizationAllowed(backup)).toBe(false)
    expect(normalizeOnboardingProfile(backup)?.exclusiveNames).toEqual(profile.exclusiveNames)
  })
  it('strips all transferable adult authorization without changing preferences', () => {
    const profile = { ...defaultOnboardingProfile('lu'), userName: '小雨', adultEnabled: true, ageConfirmed: true, adultConsent: true }
    expect(withoutAdultAuthorization(profile)).toEqual({ ...profile, adultEnabled: false, ageConfirmed: false, adultConsent: false })
    expect(profile.adultEnabled).toBe(true)
  })
})
