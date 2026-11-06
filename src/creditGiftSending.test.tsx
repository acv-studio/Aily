import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import useLocalChat from './useLocalChat'
import { db, loadLocalData } from './db'
import { creditGifts } from './creditGifts'

const credits=new Dexie('aily-billing-v1')
credits.version(1).stores({ledger:'id'})
beforeEach(async()=>{localStorage.clear();sessionStorage.clear();await db.delete();await db.open();await credits.open();await credits.table('ledger').clear()})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const successful=()=>new Response(JSON.stringify({content:[{type:'text',text:'谢谢你的小心意。'}],stop_reason:'end_turn'}))
async function setup(){const hook=renderHook(useLocalChat);await waitFor(()=>expect(hook.result.current.ready).toBe(true));act(()=>{hook.result.current.setApiKey('test');hook.result.current.setEndpoint('http://127.0.0.1:3425/v1/messages')});return hook}
it('uses the agreed prices for all six gifts',()=>expect(creditGifts.map(g=>g.cost)).toEqual([3,5,8,10,10,10]))
it('persists a virtual gift, includes one real AI reply and charges exactly its price',async()=>{
 const hook=await setup();act(()=>hook.result.current.setDraft('尚未发送的草稿'))
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>successful())
 await act(async()=>{await hook.result.current.send({giftId:'flower',rejectOnFailure:true})})
 expect(fetch).toHaveBeenCalledTimes(1)
 expect(hook.result.current.draft).toBe('尚未发送的草稿')
 expect(hook.result.current.chatMessages.find(m=>m.from==='user')).toMatchObject({giftId:'flower',status:'sent'})
 expect(hook.result.current.chatMessages.some(m=>m.from==='character'&&m.text==='谢谢你的小心意。')).toBe(true)
 const ledger=await credits.table('ledger').get('main');expect(ledger.used).toBe(3);expect(ledger.holds).toEqual({})
 expect((await loadLocalData()).conversations.lu?.[0]?.giftId).toBe('flower')
 hook.unmount()
})
it('releases failed gift cost and retries the same gift at 10 points rather than one',async()=>{
 const hook=await setup();const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('failed',{status:500})).mockImplementation(async()=>successful())
 await act(async()=>{await expect(hook.result.current.send({giftId:'movie',rejectOnFailure:true})).rejects.toThrow()})
 let ledger=await credits.table('ledger').get('main');expect(ledger.used).toBe(0);expect(ledger.holds).toEqual({})
 const failed=hook.result.current.chatMessages.find(m=>m.from==='user')!;expect(failed).toMatchObject({giftId:'movie',status:'failed'})
 await act(async()=>{await hook.result.current.send({retryId:failed.id})})
 ledger=await credits.table('ledger').get('main');expect(ledger.used).toBe(10);expect(fetch).toHaveBeenCalledTimes(2)
 expect(hook.result.current.chatMessages.filter(m=>m.from==='user')).toHaveLength(1)
 hook.unmount()
})
it('does not pretend to send gifts when no model is configured',async()=>{
 const hook=await setup();act(()=>hook.result.current.setApiKey(''))
 const fetch=vi.spyOn(globalThis,'fetch')
 await act(async()=>{await expect(hook.result.current.send({giftId:'drink',rejectOnFailure:true})).rejects.toThrow('配置')})
 expect(fetch).not.toHaveBeenCalled();expect(await db.messages.count()).toBe(0)
 hook.unmount()
})
