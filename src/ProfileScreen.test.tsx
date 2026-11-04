import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileScreen from './ProfileScreen'
import { setLocale } from './i18n'

beforeEach(() => setLocale('zh-CN'))
afterEach(() => { cleanup(); setLocale('zh-CN'); vi.restoreAllMocks() })
function setup(overrides: Partial<ComponentProps<typeof ProfileScreen>> = {}) {
  const props = {
    userName: '小雨', primaryName: '陆听澜', primaryId: 'lu' as const, setPrimary: vi.fn().mockResolvedValue(undefined),
    apiKey: '', endpoint: 'https://api.deepseek.com', model: 'deepseek-chat',
    setApiKey: vi.fn(), setEndpoint: vi.fn(), setModel: vi.fn(), onImported: vi.fn(), onCleared: vi.fn(),
    beforeDataChange: vi.fn().mockResolvedValue(undefined), openPreferences: vi.fn(),
    openProactive: vi.fn(), openInvite: vi.fn(), openPrivacy: vi.fn(), ...overrides,
  }
  const view = render(<ProfileScreen {...props} />)
  return { ...props, view }
}

describe('organized profile settings', () => {
  it('puts the editable profile first and connects all grouped actions', () => {
    const props = setup()
    expect(screen.getAllByRole('button')[0]).toHaveAccessibleName('编辑本机陪伴档案')
    expect(screen.getByRole('region', { name: '陪伴与互动' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '通用设置' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑本机陪伴档案' }))
    fireEvent.click(screen.getByRole('button', { name: '修改称呼与互动偏好' }))
    expect(props.openPreferences).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '主角色 陆听澜' }))
    expect(screen.getByRole('radiogroup', { name: '主角色' })).toBeInTheDocument()
    expect(props.setPrimary).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '角色主动消息设置' }))
    fireEvent.click(screen.getByRole('button', { name: '邀请朋友' }))
    fireEvent.click(screen.getByRole('button', { name: '安全与隐私' }))
    expect(props.openProactive).toHaveBeenCalledOnce()
    expect(props.openInvite).toHaveBeenCalledOnce()
    expect(props.openPrivacy).toHaveBeenCalledOnce()
  })

  it('expands all three existing companions with avatars, titles and the current primary choice, and collapses without saving', () => {
    const props = setup({ primaryId: 'gu', primaryName: '顾辰泽' })
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    const entry = screen.getByRole('button', { name: '主角色 顾辰泽' })
    expect(entry).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(entry)
    expect(entry).toHaveAttribute('aria-expanded', 'true')
    const group = screen.getByRole('radiogroup', { name: '主角色' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
    expect(within(group).getByRole('radio', { name: '陆听澜 温柔年上 · 行动派' })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: '陈奕恒 对抗路 · 年下恋人' })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: '顾辰泽 克制强势 · 边界清晰' })).toBeChecked()
    for (const avatar of ['澜', '奕', '泽']) expect(within(group).getByText(avatar)).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(within(group).getByRole('radio', { name: /顾辰泽/ }))
    fireEvent.click(entry)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(entry).toHaveAttribute('aria-expanded', 'false')
    expect(props.setPrimary).not.toHaveBeenCalled()
  })

  it('awaits saving, disables choices and uses only the persisted primaryId for checked state', async () => {
    let complete!: () => void
    const setPrimary = vi.fn().mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
    const props = setup({ setPrimary })
    fireEvent.click(screen.getByRole('button', { name: '主角色 陆听澜' }))
    fireEvent.click(screen.getByRole('radio', { name: /陈奕恒/ }))
    expect(setPrimary).toHaveBeenCalledExactlyOnceWith('chen')
    expect(screen.getByRole('status')).toHaveTextContent('正在保存主角色…')
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-busy', 'true')
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByRole('radio', { name: /陆听澜/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /陈奕恒/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /顾辰泽/ }))
    expect(setPrimary).toHaveBeenCalledTimes(1)
    await act(async () => { complete() })
    expect(screen.getByRole('status')).toHaveTextContent('主角色已更新')
    expect(screen.getByRole('radio', { name: /陆听澜/ })).toBeChecked()
    props.view.rerender(<ProfileScreen {...props} primaryId="chen" primaryName="陈奕恒" />)
    expect(screen.getByRole('radio', { name: /陈奕恒/ })).toBeChecked()
    expect(screen.getByRole('button', { name: '主角色 陈奕恒' })).toHaveAttribute('aria-expanded', 'true')
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '主角色 陈奕恒' }))
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  it('shows a readable save failure, keeps the old selection and permits retry', async () => {
    const setPrimary = vi.fn().mockRejectedValueOnce(new Error('IndexedDB transaction failed')).mockResolvedValue(undefined)
    const props = setup({ setPrimary })
    fireEvent.click(screen.getByRole('button', { name: '主角色 陆听澜' }))
    fireEvent.click(screen.getByRole('radio', { name: /顾辰泽/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('主角色保存失败，请重新选择以重试。')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /陆听澜/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /顾辰泽/ })).not.toBeChecked()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled()
    fireEvent.click(screen.getByRole('radio', { name: /顾辰泽/ }))
    expect(await screen.findByText('主角色已更新')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(setPrimary).toHaveBeenNthCalledWith(1, 'gu')
    expect(setPrimary).toHaveBeenNthCalledWith(2, 'gu')
    props.view.rerender(<ProfileScreen {...props} primaryId="gu" primaryName="顾辰泽" />)
    expect(screen.getByRole('radio', { name: /顾辰泽/ })).toBeChecked()
  })

  it('localizes the inline choices and save feedback in English', async () => {
    setLocale('en')
    setup({ setPrimary: vi.fn().mockRejectedValue(new Error('failed')) })
    fireEvent.click(screen.getByRole('button', { name: 'Main companion Lu Tinglan' }))
    const group = screen.getByRole('radiogroup', { name: 'Main companion' })
    expect(within(group).getByRole('radio', { name: 'Lu Tinglan Warm & steady · Acts with care' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Chen Yiheng Playful & teasing · Younger partner' })).not.toBeChecked()
    fireEvent.click(within(group).getByRole('radio', { name: /Gu Chenze/ }))
    expect(screen.getByRole('status')).toHaveTextContent('Saving main companion…')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your main companion. Select a companion again to retry.')
  })

  it('collapses language settings by default and supports live bilingual switching', () => {
    setup()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const entry = screen.getByRole('button', { name: '语言设置 简体中文' })
    expect(entry).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(entry)
    expect(entry).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(screen.getByRole('combobox', { name: '界面语言 / Interface language' }), { target: { value: 'en' } })
    expect(screen.getByRole('heading', { name: 'General settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Language settings English' }))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('retains API configuration and session key deletion', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 连接 演示模式' }))
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'test-key' } })
    expect(props.setApiKey).toHaveBeenCalledWith('test-key')
    fireEvent.click(screen.getByRole('button', { name: '删除 Key' }))
    expect(props.setApiKey).toHaveBeenLastCalledWith('')
    expect(screen.getByRole('status')).toHaveTextContent('已删除本次会话中的 Key')
    expect(screen.getByRole('region', { name: '本机聊天与记忆' })).toBeInTheDocument()
  })

  it('does not imply membership is available or gate basic chat behind payment', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '了解会员' }))
    expect(screen.getByText('会员功能尚未开放，当前可免费体验基础聊天与本机记忆。')).toBeInTheDocument()
  })
})
