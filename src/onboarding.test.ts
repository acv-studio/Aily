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
  it('strips all transferable adult authorization without changing preferences', () => {
    const profile = { ...defaultOnboardingProfile('lu'), userName: '小雨', adultEnabled: true, ageConfirmed: true, adultConsent: true }
    expect(withoutAdultAuthorization(profile)).toEqual({ ...profile, adultEnabled: false, ageConfirmed: false, adultConsent: false })
    expect(profile.adultEnabled).toBe(true)
  })
})
