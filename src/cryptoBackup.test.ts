import { describe, expect, it } from 'vitest'
import { decryptBackup, encryptBackup } from './cryptoBackup'

describe('encrypted backups', () => {
  it('round trips private data without exposing plaintext', async () => {
    const encrypted = await encryptBackup('{"private":"memory"}', 'secret12')
    expect(encrypted).not.toContain('memory')
    await expect(decryptBackup(encrypted, 'wrong12')).rejects.toThrow('密码错误')
    expect(await decryptBackup(encrypted, 'secret12')).toBe('{"private":"memory"}')
  })

  it('requires a useful password length', async () => {
    await expect(encryptBackup('{}', '123')).rejects.toThrow('至少需要 6 位')
  })
})
