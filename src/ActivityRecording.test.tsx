import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useLocalChat from './useLocalChat'
import { db, exportData, importData, persistChatChanges } from './db'
import { buildContext, excludedMemorySourceIds, type ChatMessage } from './chatService'
import { defaultMemoryPolicy, extractCandidates, summarizeConversation } from './longMemory'
beforeEach(async()=>{localStorage.clear();sessionStorage.clear();await db.delete();await db.open()})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
async function setup(){const hook=renderHook(useLocalChat);await waitFor(()=>expect(hook.result.current.ready).toBe(true));return hook}
it('saves a mode change and its activity without a false recording failure',async()=>{
 const hook=await setup();const fetch=vi.spyOn(globalThis,'fetch')
 await act(async()=>{await hook.result.current.setReplyMode('deep');await hook.result.current.recordActivity('你将聊天模式切换为「深入聊天」')})
 expect(hook.result.current.replyMode).toBe('deep');expect(hook.result.current.chatMessages).toHaveLength(1)
 expect((await db.messages.toArray())[0]).toMatchObject({text:'你将聊天模式切换为「深入聊天」',status:'sent'})
 expect(fetch).not.toHaveBeenCalled();hook.unmount()
})
it('persists private activities but excludes them and linked replies from model context, extraction and summaries',async()=>{
 const hook=await setup();await act(async()=>{await hook.result.current.recordActivity('我喜欢牛奶，这是只想本机保留的记录',true)})
 const privateMessage=hook.result.current.chatMessages[0];expect(privateMessage.localOnly).toBe(true)
 const messages:ChatMessage[]=[privateMessage,{id:privateMessage.id+1,from:'character',text:'我记得你的牛奶偏好',time:'',status:'sent',replyToId:privateMessage.id,createdAt:privateMessage.createdAt},{id:privateMessage.id+2,from:'user',text:'今天天气不错',time:'',status:'sent',createdAt:privateMessage.createdAt}]
 expect(excludedMemorySourceIds(messages)).toEqual(expect.arrayContaining([privateMessage.id,privateMessage.id+1]))
 expect(extractCandidates('lu',messages,[],defaultMemoryPolicy)).toEqual([])
 const summaries=summarizeConversation('lu',messages,defaultMemoryPolicy);expect(summaries.length).toBeGreaterThan(0)
 expect(JSON.stringify(summaries)).not.toContain('牛奶')
 summaries.forEach(summary=>expect(summary.sourceMessageIds).not.toContain(privateMessage.id+1))
 expect(JSON.stringify(buildContext('lu',messages,[],summaries,defaultMemoryPolicy))).not.toContain('牛奶')
 hook.unmount();const data=await importData(await exportData());expect(data.conversations.lu?.[0].localOnly).toBe(true)
})
it('rejects a malformed privacy marker without writing any message',async()=>{
 await expect(persistChatChanges('lu',[{id:1,from:'user',text:'not valid',time:'',localOnly:'yes'} as unknown as ChatMessage])).rejects.toThrow()
 expect(await db.messages.count()).toBe(0)
})
