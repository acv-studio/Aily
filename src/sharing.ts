import type { ChatMessage, ConfirmedMemory } from './chatService'
import { characters, type CharacterId } from './data'
import { canRecall, isSensitive, type MemoryPolicy } from './longMemory'

export function shareableMemory(memory: ConfirmedMemory, policy?: MemoryPolicy, messages?: ChatMessage[], now = Date.now()) {
  return memory.category === 'relationship' && canRecall(memory, policy, now)
    && !memory.sensitive && !isSensitive(memory.text)
    && Number.isFinite(Date.parse(memory.confirmedAt)) && Date.parse(memory.confirmedAt) <= now
    && (memory.sourceMessageId === undefined || !!messages?.some(message => message.id === memory.sourceMessageId && !message.withdrawn))
}

/** A role recommendation, not a referral identifier or account/reward claim. */
export function invitationLink(role: CharacterId, location = window.location.href) {
  const url = new URL(location)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('请在可访问的网页地址中生成邀请链接')
  url.username = ''; url.password = ''; url.search = ''; url.hash = `invite=${role}`
  return url.href
}

export function invitedRole(hash: string): CharacterId | null {
  const match = /^#invite=(lu|chen|gu)$/.exec(hash)
  return match ? match[1] as CharacterId : null
}

export const defaultCardText = '把一个平凡的瞬间，留成值得记住的故事。'
export type MemoryCard = { role: CharacterId; text: string }

/** Only this explicit public draft is painted; no chat, IDs, profile or attachments are exported. */
export async function renderMemoryCard(card: MemoryCard): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 900; canvas.height = 1200
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法生成图片')
  const character = characters.find(item => item.id === card.role)!
  ctx.fillStyle = '#10231f'; ctx.fillRect(0, 0, 900, 1200)
  const glow = ctx.createRadialGradient(640, 240, 20, 640, 240, 700)
  glow.addColorStop(0, character.accent); glow.addColorStop(1, '#10231f')
  ctx.globalAlpha = .25; ctx.fillStyle = glow; ctx.fillRect(0, 0, 900, 1200); ctx.globalAlpha = 1
  ctx.strokeStyle = character.accent; ctx.lineWidth = 2; ctx.strokeRect(48, 48, 804, 1104)
  ctx.fillStyle = character.accent; ctx.font = '24px sans-serif'; ctx.fillText('AILY · 共同回忆', 96, 124)
  ctx.beginPath(); ctx.arc(450, 320, 100, 0, Math.PI * 2); ctx.stroke()
  ctx.font = '72px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(character.avatar, 450, 345)
  ctx.fillStyle = '#f0f7f3'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('我们的一个瞬间', 450, 520)
  ctx.font = '28px sans-serif'; ctx.fillText(`与 ${character.name} · AI 角色`, 450, 580)
  ctx.font = '32px sans-serif'
  const lines: string[] = []; let line = ''
  for (const char of Array.from(card.text.trim() || defaultCardText).slice(0, 120)) {
    if (char === '\n' || ctx.measureText(line + char).width > 680) { lines.push(line); line = char === '\n' ? '' : char }
    else line += char
  }
  lines.push(line)
  lines.slice(0, 8).forEach((text, index) => ctx.fillText(text, 450, 690 + index * 46))
  ctx.fillStyle = '#bed0c8'; ctx.font = '22px sans-serif'; ctx.fillText('由用户选择公开 · AI 陪伴，不是真人关系', 450, 1080)
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片生成失败，请重试')), 'image/png'))
}

export async function shareCard(blob: Blob) {
  const file = new File([blob], 'aily-memory.png', { type: 'image/png' })
  if (!navigator.canShare?.({ files: [file] }) || !navigator.share) return false
  await navigator.share({ files: [file], title: 'Aily 共同回忆' })
  return true
}

export function downloadCard(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'aily-memory.png'; anchor.click()
  // Let the browser consume the URL before revoking it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
