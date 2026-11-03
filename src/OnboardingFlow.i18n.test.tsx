import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Onboarding, { OnboardingEditor } from './OnboardingFlow'
import { setLocale } from './i18n'
import { defaultOnboardingProfile } from './onboarding'

beforeEach(() => setLocale('en'))
afterEach(() => { cleanup(); setLocale('zh-CN') })

const continueSetup = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

describe('bilingual onboarding and profile editor', () => {
  it('localizes all nine steps and trial copy while preserving entered names', async () => {
    const finish = vi.fn().mockResolvedValue(undefined)
    render(<Onboarding selected="lu" setSelected={vi.fn()} finish={finish} apiKey="" setApiKey={vi.fn()} />)
    expect(screen.getByLabelText('界面语言 / Interface language')).toHaveValue('en')
    expect(screen.getByText('Step 1 of 9 · First meeting')).toBeInTheDocument()
    const encounter = screen.getByRole('button', { name: 'Meet your companion' })
    expect(encounter).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I am at least 18 years old'))
    expect(encounter).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I understand the AI identity and data disclosures'))
    expect(encounter).toBeEnabled()
    fireEvent.click(encounter)
    expect(screen.getByText('Lu Tinglan')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start our story' }))
    expect(screen.getByText('Lu Tinglan · AI character')).toBeInTheDocument()
    continueSetup()
    expect(screen.getByLabelText('Your name or nickname')).toHaveValue('You')
    fireEvent.change(screen.getByLabelText('Your name or nickname'), { target: { value: '阿雨' } })
    continueSetup()
    expect(screen.getByLabelText('What would you like to call your companion?')).toHaveValue('Lu Tinglan')
    fireEvent.change(screen.getByLabelText('What would you like to call your companion?'), { target: { value: '小澜' } })
    continueSetup()
    expect(screen.getByLabelText('Reply length')).toHaveValue('short')
    continueSetup()
    expect(screen.getByText('Adult mode: off (default)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Learn about & confirm adult mode' }))
    expect(screen.getByLabelText('Safety word')).toHaveValue('Stop')
    fireEvent.click(screen.getByRole('button', { name: 'Keep off' }))
    continueSetup()
    fireEvent.click(screen.getByRole('button', { name: 'Send a trial greeting' }))
    expect(screen.getByText('小澜, I wanted to start by saying hello today.')).toBeInTheDocument()
    expect(screen.getByText('I hear you, 阿雨. You can call me 小澜. Tell me anytime you’d like to change that.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'These names feel right — continue' }))
    expect(screen.getByRole('heading', { name: 'Before we begin: your data' })).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Finish setup' })) })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ userName: '阿雨', characterName: '小澜' }), expect.any(Array))
  })

  it('switches editor labels and errors live without translating profile values', async () => {
    const save = vi.fn().mockRejectedValue(new Error('storage'))
    const profile = { ...defaultOnboardingProfile('chen'), userName: '艳艳', characterName: '阿恒', blockedTopics: '工作 / work', safeWord: '停一下', notificationStart: '23:15', notificationEnd: '07:30' }
    render(<OnboardingEditor initial={profile} save={save} close={vi.fn()} />)
    expect(screen.getByLabelText('Your name or nickname')).toHaveValue('艳艳')
    expect(screen.getByLabelText('What would you like to call your companion?')).toHaveValue('阿恒')
    expect(screen.getByLabelText('Topics to avoid')).toHaveValue('工作 / work')
    expect(screen.getByLabelText('Notifications allowed from')).toHaveValue('23:15')
    expect(screen.getByLabelText('Notifications allowed until')).toHaveValue('07:30')
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Preferences were not saved.')
    expect(save).toHaveBeenCalledWith(profile)
    fireEvent.change(screen.getByLabelText('界面语言 / Interface language'), { target: { value: 'zh-CN' } })
    expect(screen.getByRole('heading', { name: '称呼与互动偏好' })).toBeInTheDocument()
    expect(screen.getByLabelText('你的名字或昵称')).toHaveValue('艳艳')
    expect(screen.getByLabelText('你想怎么称呼 TA')).toHaveValue('阿恒')
    expect(screen.getByRole('alert')).toHaveTextContent('偏好未保存')
  })
})
