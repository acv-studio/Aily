import { afterEach, expect, it, vi } from 'vitest'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { testDeepSeekConnection } from './chatService'
vi.mock('@capacitor/core', async () => { const actual = await vi.importActual<typeof import('@capacitor/core')>('@capacitor/core'); return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: vi.fn(() => false) }, CapacitorHttp: { request: vi.fn() } } })

afterEach(() => vi.restoreAllMocks())
it('uses native HTTP for the bundled Magpie endpoint instead of the Vite-only proxy', async () => {
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
  const native = vi.spyOn(CapacitorHttp, 'request').mockResolvedValue({ status: 200, headers: {}, url: '', data: { content: [{ type: 'text', text: 'Hi' }] } })
  const web = vi.spyOn(globalThis, 'fetch')
  await expect(testDeepSeekConnection({ apiKey: 'magpie', endpoint: '/api/magpie/v1/messages', model: 'ferry/claude-gpt-5-6-luna' })).resolves.toBe(true)
  expect(native).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:3425/v1/messages', headers: expect.objectContaining({ 'x-api-key': 'magpie' }), data: expect.objectContaining({ model: 'ferry/claude-gpt-5-6-luna' }) }))
  expect(web).not.toHaveBeenCalled()
})
