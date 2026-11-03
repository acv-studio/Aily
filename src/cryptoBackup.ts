import { t } from './i18n'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}
function base64ToBytes(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)) }

async function deriveKey(password: string, salt: Uint8Array, usages: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 150_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, usages)
}

export async function encryptBackup(plainText: string, password: string) {
  if (password.length < 6) throw new Error(t('备份密码至少需要 6 位'))
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ['encrypt'])
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plainText))
  return JSON.stringify({ format: 'aily-encrypted-backup', version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) })
}

export async function decryptBackup(raw: string, password: string) {
  try {
    const envelope = JSON.parse(raw)
    if (envelope.format !== 'aily-encrypted-backup' || envelope.version !== 1) return raw
    const salt = base64ToBytes(envelope.salt); const iv = base64ToBytes(envelope.iv)
    const key = await deriveKey(password, salt, ['decrypt'])
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.data))
    return decoder.decode(plain)
  } catch { throw new Error(t('密码错误或备份文件已损坏')) }
}
