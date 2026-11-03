import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ConfirmedMemory } from './chatService'
import { defaultMemoryPolicy } from './longMemory'
import { albumMonths, albumText, downloadAlbum, redactAlbumText } from './monthlyAlbum'

const event: ConfirmedMemory = {
  id: 'memory-seaside', characterId: 'lu', category: 'relationship',
  text: '我们一起完成海边故事', confirmedAt: '2026-11-02T12:00:00Z',
  state: 'confirmed', sourceMessageId: 123456789,
}
const source: ChatMessage = {
  id: 123456789, from: 'user', text: '用户原始聊天内容', time: '20:00',
  attachment: { name: 'private-photo.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,cHJpdmF0ZQ==' },
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('albumMonths', () => {
  it('isolates the selected character and relationship category without mutating inputs', () => {
    const otherRole: ConfirmedMemory = { ...event, id: 'other-role', characterId: 'chen' }
    const memories: ConfirmedMemory[] = [
      otherRole, { ...event, id: 'profile', category: 'profile' },
      { ...event, id: 'context', category: 'context' },
      { ...event, id: 'emotion', category: 'emotion' },
      { ...event, id: 'uncategorized', category: undefined }, event,
    ]
    const originalOrder = [...memories]
    const messages = [source]
    expect(albumMonths(memories, 'lu', defaultMemoryPolicy, messages)).toEqual([{ month: '2026-11', events: [event] }])
    expect(albumMonths(memories, 'chen', defaultMemoryPolicy, messages)).toEqual([{ month: '2026-11', events: [otherRole] }])
    expect(albumMonths(memories, 'gu', defaultMemoryPolicy, messages)).toEqual([])
    expect(memories).toEqual(originalOrder)
    expect(messages).toEqual([source])
  })

  it.each<[string, Partial<ConfirmedMemory>]>([
    ['pending', { state: 'pending' }],
    ['archived', { state: 'archived' }],
    ['rejected', { state: 'rejected' }],
    ['disabled', { enabled: false }],
    ['expired', { expiresAt: '2026-11-01T00:00:00Z' }],
    ['invalid expiry', { expiresAt: 'invalid' }],
    ['empty text', { text: ' \n\t ' }],
    ['sensitive flag', { sensitive: true }],
    ['sensitive text', { text: '我们讨论了我的抑郁诊断', sensitive: false }],
    ['sensitive original text', { originalText: 'my medical diagnosis', sensitive: false }],
    ['fullwidth sensitive original text', { originalText: 'ｐｒｉｖａｔｅ＠ｅｘａｍｐｌｅ．ｃｏｍ' }],
    ['weekly journal', { text: '【周记 · 2026-W45】\n本机共同经历摘录' }],
    ['monthly journal', { text: '【月记 · 2026-11】\n本机共同经历摘录' }],
    ['invalid confirmation date', { confirmedAt: 'not-a-date' }],
  ])('excludes %s records', (_label, overrides) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T00:00:00Z'))
    expect(albumMonths([{ ...event, ...overrides }], 'lu', defaultMemoryPolicy, [])).toEqual([])
  })

  it('excludes withdrawn sources while allowing active, missing, and source-free memories', () => {
    const sourceFree: ConfirmedMemory = { ...event, id: 'source-free', sourceMessageId: undefined }
    const missingSource: ConfirmedMemory = { ...event, id: 'missing-source', sourceMessageId: 987 }
    expect(albumMonths([event], 'lu', defaultMemoryPolicy, [source])[0].events).toEqual([event])
    const months = albumMonths([event, sourceFree, missingSource], 'lu', defaultMemoryPolicy, [{ ...source, withdrawn: true }])
    expect(months[0].events).toEqual([missingSource, sourceFree])
  })

  it('honors extraction and category policy controls even for confirmed records', () => {
    expect(albumMonths([event], 'lu', { ...defaultMemoryPolicy, extractionEnabled: false }, [source])).toEqual([])
    expect(albumMonths([event], 'lu', { ...defaultMemoryPolicy, disabledCategories: ['relationship'] }, [source])).toEqual([])
    expect(albumMonths([event], 'lu', { ...defaultMemoryPolicy, disabledCategories: ['profile'] }, [source])).toEqual([{ month: '2026-11', events: [event] }])
  })

  it('retains legacy confirmed and unexpired memories regardless of age', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T00:00:00Z'))
    const legacy: ConfirmedMemory = { ...event, state: undefined, confirmedAt: '2000-01-01T00:00:00Z', expiresAt: '2026-11-05T00:00:00Z' }
    expect(albumMonths([legacy], 'lu', defaultMemoryPolicy, [])).toEqual([{ month: '2000-01', events: [legacy] }])
    expect(albumMonths([{ ...legacy, expiresAt: '2026-11-04T00:00:00Z' }], 'lu', defaultMemoryPolicy, [])).toEqual([])
  })

  it('groups by UTC month across timezone/year boundaries and orders actual instants with ID tie breaks', () => {
    const october: ConfirmedMemory = { ...event, id: 'october', confirmedAt: '2026-11-01T00:30:00+08:00' }
    const november: ConfirmedMemory = { ...event, id: 'november', confirmedAt: '2026-10-31T23:30:00-02:00' }
    const tieA: ConfirmedMemory = { ...event, id: 'a', confirmedAt: '2026-11-01T02:00:00Z' }
    const tieZ: ConfirmedMemory = { ...event, id: 'z', confirmedAt: '2026-11-01T10:00:00+08:00' }
    const december: ConfirmedMemory = { ...event, id: 'december', confirmedAt: '2027-01-01T00:30:00+08:00' }
    const january: ConfirmedMemory = { ...event, id: 'january', confirmedAt: '2026-12-31T23:30:00-02:00' }
    expect(albumMonths([tieZ, october, january, tieA, november, december], 'lu', defaultMemoryPolicy, [])).toEqual([
      { month: '2027-01', events: [january] },
      { month: '2026-12', events: [december] },
      { month: '2026-11', events: [november, tieA, tieZ] },
      { month: '2026-10', events: [october] },
    ])
  })
})

describe('albumText privacy', () => {
  it('defaults to anonymous placeholders, not raw text, source IDs, attachments, exact dates, or user name', () => {
    const userName = 'Private User'
    const memory = { ...event, text: `We visited the coast with ${userName}`, originalText: 'Original private wording' }
    const [{ month, events }] = albumMonths([memory], 'lu', defaultMemoryPolicy, [source])
    const output = albumText(month, 'lu', events, false, [userName], 'zh-CN')
    expect(output).toContain('2026-11 · 陆听澜')
    expect(output).toContain('本月珍藏了 1 件共同经历')
    expect(output).toContain('1. 一起珍藏的一件小事')
    expect(output).toContain('AI 角色陪伴，非真人关系')
    for (const privateValue of [memory.text, memory.originalText, memory.id, String(memory.sourceMessageId), memory.confirmedAt, source.text, source.attachment!.name, source.attachment!.dataUrl, userName]) {
      expect(output).not.toContain(privateValue)
    }
  })

  it('includes only explicitly selected excerpts and redacts custom names after opt-in', () => {
    const selected = { ...event, text: 'Enjoyed the coast with Private User.' }
    const unselected = { ...event, id: 'unselected', text: 'Unselected private story' }
    const output = albumText('2026-11', 'lu', [selected], true, ['Private User'], 'en')
    expect(output).toContain('1. Enjoyed the coast with […].')
    expect(output).not.toContain('Private User')
    expect(output).not.toContain(unselected.text)
    expect(output).not.toContain(selected.id)
    expect(output).not.toContain('一起珍藏的一件小事')
  })

  it('applies common-identifier redaction to opted-in excerpts without exposing metadata', () => {
    const memory = {
      ...event,
      text: 'Coast walk. alice@example.org; https://example.org/private; +86 (138) 0013-8000; sk-private123; My name is Alice.',
      originalText: 'Do not export this original wording',
    }
    const output = albumText('2026-11', 'lu', [memory], true, [], 'zh-CN')
    expect(output).toContain('1. Coast walk.')
    expect(output).toContain('[…]')
    for (const privateValue of ['alice@example.org', 'https://example.org/private', '138', 'sk-private123', 'Alice', memory.originalText, memory.id, String(memory.sourceMessageId)]) {
      expect(output).not.toContain(privateValue)
    }
  })

  it('numbers placeholders without leaking excerpts when there are multiple events', () => {
    const output = albumText('2026-11', 'lu', [event, { ...event, id: 'second', text: 'Second private story' }], false, [], 'zh-CN')
    expect(output).toContain('本月珍藏了 2 件共同经历')
    expect(output).toContain('1. 一起珍藏的一件小事\n2. 一起珍藏的一件小事')
    expect(output).not.toContain(event.text)
    expect(output).not.toContain('Second private story')
  })
})

describe('redactAlbumText', () => {
  it.each([
    ['HTTPS URL', 'https://example.org/private?q=secret'],
    ['HTTP URL', 'http://example.org/private'],
    ['www URL', 'www.example.org/private'],
    ['email', 'alice.smith+album@example.co.uk'],
    ['phone number', '+86 (138) 0013-8000'],
    ['long identifier', '11010519491231002X'],
    ['IPv4 address', '192.168.1.24'],
    ['API credential', 'sk-private_key-123'],
    ['bearer credential', 'Bearer private_key-123'],
    ['Chinese name', '我叫小明'],
    ['Chinese preferred name', '叫我小明'],
    ['Chinese full name', '我的名字是小明'],
    ['English name', 'My name is Alice Smith'],
    ['English preferred name', 'Call me Alice'],
  ])('redacts common identifier: %s', (_label, identifier) => {
    expect(redactAlbumText(`Before ${identifier}。 After`)).toBe('Before […]。 After')
  })

  it('treats custom terms literally, case-insensitively, rather than as regex patterns', () => {
    const terms = ['A+B', '[team]', '(name)', 'x.y', 'a*b?', '^foo$', '${secret}', 'a|b', 'C:\\Users\\Me']
    const text = terms.map(term => term.toUpperCase()).join(' / ')
    expect(redactAlbumText(text, terms)).toBe(terms.map(() => '[…]').join(' / '))
    expect(redactAlbumText('axb aab plain words', ['x.y', 'a+b'])).toBe('axb aab plain words')
  })

  it('normalizes and deduplicates custom terms, skips blanks, and redacts longest overlaps first', () => {
    const terms = [' Alice ', 'Alice Smith', 'Ａｌｉｃｅ Ｓｍｉｔｈ', '', '   ']
    expect(redactAlbumText('ALICE SMITH and Alice', terms)).toBe('[…] and […]')
    expect(terms).toEqual([' Alice ', 'Alice Smith', 'Ａｌｉｃｅ Ｓｍｉｔｈ', '', '   '])
  })

  it('normalizes fullwidth identifiers and custom terms before matching', () => {
    expect(redactAlbumText('ａｌｉｃｅ＠ｅｘａｍｐｌｅ．ｃｏｍ')).toBe('[…]')
    expect(redactAlbumText('１３８００１３８０００')).toBe('[…]')
    expect(redactAlbumText('ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｏｒｇ／ｐｒｉｖａｔｅ')).toBe('[…]')
    expect(redactAlbumText('Ａ＋Ｂ and a+b', ['Ａ＋Ｂ'])).toBe('[…] and […]')
  })

  it('removes controls, collapses whitespace, trims, and bounds excerpts to 240 characters', () => {
    expect(redactAlbumText(' \u0000Hello\t\n  world\u007f ')).toBe('Hello world')
    expect(redactAlbumText('x'.repeat(500))).toBe('x'.repeat(240))
    expect(redactAlbumText('')).toBe('')
  })

  it('redacts identifiers and literal custom terms before truncating at a boundary', () => {
    const prefix = `${'x'.repeat(230)} `
    expect(redactAlbumText(`${prefix}alice@example.org trailing`)).toBe(`${prefix}[…] trail`)
    const custom = 'Private.Name+[VeryLongUser]'
    const output = redactAlbumText(`${prefix}${custom} trailing`, [custom])
    expect(output).toBe(`${prefix}[…] trail`)
    expect(output).toHaveLength(240)
    expect(output).not.toContain('Private')
    expect(output).not.toContain('alice')
  })
})

describe('downloadAlbum', () => {
  function mockDownload() {
    vi.useFakeTimers()
    const createObjectURL = vi.fn().mockReturnValue('blob:monthly-album-test')
    const revokeObjectURL = vi.fn()
    const NativeURL = URL
    vi.stubGlobal('URL', class extends NativeURL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true)
      expect(this.href).toBe('blob:monthly-album-test')
      expect(this.download).toBe('aily-monthly-2026-11.txt')
    })
    return { createObjectURL, revokeObjectURL, click }
  }

  it('downloads a UTF-8 text blob, removes the temporary link, and revokes the URL after a delay', () => {
    const { createObjectURL, revokeObjectURL, click } = mockDownload()
    downloadAlbum('Private preview text', '2026-11')
    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/plain;charset=utf-8')
    expect(blob.size).toBe('Private preview text'.length)
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download="aily-monthly-2026-11.txt"]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(999)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:monthly-album-test')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still removes the link and revokes the object URL if clicking the download throws', () => {
    const { click, revokeObjectURL } = mockDownload()
    click.mockImplementation(() => { throw new Error('download blocked') })
    expect(() => downloadAlbum('Preview text', '2026-11')).toThrow('download blocked')
    expect(document.querySelector('a[download="aily-monthly-2026-11.txt"]')).toBeNull()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:monthly-album-test')
  })
})
