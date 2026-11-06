import { useEffect, useSyncExternalStore } from 'react'
import Dexie, { type Table } from 'dexie'
import { Capacitor, registerPlugin } from '@capacitor/core'

export const planMultipliers = { 'com.aily.app.monthly.5x':5, 'com.aily.app.monthly.10x':10, 'com.aily.app.monthly.20x':20, 'com.aily.app.monthly.50x':50 } as const
export type PlanId = keyof typeof planMultipliers
export type PointCost = 1 | 3 | 5 | 8 | 10
export type Entitlement = { productId:PlanId|null; multiplier:number; expiresAt:string|null }
export type StoreProduct = { id:PlanId; displayPrice:string; displayName:string; description:string }
interface NativeBilling { products():Promise<{products:StoreProduct[]}>; purchase(options:{productId:PlanId}):Promise<{status:'purchased'|'pending'|'cancelled';entitlement?:Entitlement}>; restore():Promise<{entitlement:Entitlement}>; entitlement():Promise<{entitlement:Entitlement}>; addListener(event:'entitlementChanged',listener:(result:{entitlement:Entitlement})=>void):Promise<{remove():Promise<void>}> }
const native = registerPlugin<NativeBilling>('AilyBilling')
const free:Entitlement={productId:null,multiplier:1,expiresAt:null}
interface Ledger { id:string; day:string; used:number; bonus:number; checkedIn:string|null; holds:Record<string,{cost:number;at:number}> }
class BillingDatabase extends Dexie { ledger!:Table<Ledger,string>;constructor(){super('aily-billing-v1');this.version(1).stores({ledger:'id'})} }
const db=new BillingDatabase()
const listeners=new Set<()=>void>()
let snapshot={ready:false,error:'',balance:0,dailyQuota:20,entitlement:free,products:[] as StoreProduct[],canCheckIn:true,busy:false}
let startup:Promise<void>|undefined
let connected=false
const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
const emit=(patch:Partial<typeof snapshot>)=>{snapshot={...snapshot,...patch};listeners.forEach(fn=>fn())}
export function nativeBillingAvailable(){return Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios'}
function normalizeEntitlement(value:Entitlement):Entitlement {const multiplier=value?.productId?planMultipliers[value.productId]:undefined;return multiplier&&value.expiresAt&&Date.parse(value.expiresAt)>Date.now()?{productId:value.productId,multiplier,expiresAt:value.expiresAt}:free}
function multiplier(){return normalizeEntitlement(snapshot.entitlement).multiplier}
function rollover(value?:Ledger):Ledger{const today=localDay();const row=value??{id:'main',day:today,used:0,bonus:0,checkedIn:null,holds:{}};if(row.day!==today){row.day=today;row.used=0;row.holds={}}for(const [id,hold] of Object.entries(row.holds))if(Date.now()-hold.at>120000)delete row.holds[id];return row}
function balance(row:Ledger){const holds=Object.values(row.holds).reduce((sum,h)=>sum+h.cost,0);return Math.max(0,20*multiplier()-row.used)+row.bonus-holds}
async function updateLedger<T>(work:(row:Ledger)=>T|Promise<T>):Promise<T>{const result=await db.transaction('rw',db.ledger,async()=>{const row=rollover(await db.ledger.get('main'));const value=await work(row);await db.ledger.put(row);return {row,value}});emit({ready:true,balance:Math.max(0,balance(result.row)),dailyQuota:20*multiplier(),canCheckIn:result.row.checkedIn!==localDay()});return result.value}
async function syncEntitlement(){if(nativeBillingAvailable()){const result=await native.entitlement();emit({entitlement:normalizeEntitlement(result.entitlement)})}else emit({entitlement:free})}
async function initialize(){if(!startup)startup=(async()=>{await syncEntitlement().catch(error=>emit({error:error instanceof Error?error.message:'无法读取 Apple 订阅',entitlement:free}));await updateLedger(()=>{});if(nativeBillingAvailable()&&!connected){connected=true;await native.addListener('entitlementChanged',async result=>{emit({entitlement:normalizeEntitlement(result.entitlement)});await updateLedger(()=>{})})}})().catch(error=>{startup=undefined;emit({error:error instanceof Error?error.message:'无法读取积分账本'});throw error});await startup}
export async function refreshBilling(){try{await initialize();await syncEntitlement();if(nativeBillingAvailable()){const result=await native.products();emit({products:result.products.filter(product=>product.id in planMultipliers)})}await updateLedger(()=>{});emit({error:''})}catch(error){emit({error:error instanceof Error?error.message:'无法读取购买信息'})}}
export async function reservePoints(cost:number){
  if(![1,3,5,8,10].includes(cost))throw new Error('无效的积分消耗')
  await initialize()
  const token=crypto.randomUUID()
  await updateLedger(row=>{if(balance(row)<cost)throw new Error('积分不足，请签到领取积分或查看月卡额度');row.holds[token]={cost,at:Date.now()}})
  let settled=false
  let inFlight:Promise<void>|undefined
  const settle=(work:(row:Ledger)=>void)=>{
    if(settled)return Promise.resolve()
    if(inFlight)return inFlight
    inFlight=updateLedger(work).then(()=>{settled=true}).finally(()=>{inFlight=undefined})
    return inFlight
  }
  return {
    commit:()=>settle(row=>{
      const hold=row.holds[token]
      if(!hold)throw new Error('请求已过期，请重试')
      const remaining=Math.max(0,20*multiplier()-row.used)
      const fromDaily=Math.min(remaining,hold.cost)
      const bonusCost=hold.cost-fromDaily
      if(row.bonus<bonusCost)throw new Error('积分余额不足')
      row.used+=fromDaily;row.bonus-=bonusCost;delete row.holds[token]
    }),
    release:()=>settle(row=>{delete row.holds[token]}),
  }
}
async function checkIn(){await initialize();await updateLedger(row=>{if(row.checkedIn===localDay())throw new Error('今天已签到');row.bonus+=20;row.checkedIn=localDay()})}
async function purchase(id:PlanId){if(!nativeBillingAvailable())throw new Error('请在 iPhone App 中使用 Apple 内购');if(snapshot.busy)return;emit({busy:true,error:''});try{const result=await native.purchase({productId:id});if(result.status==='purchased'&&result.entitlement)emit({entitlement:normalizeEntitlement(result.entitlement)});if(result.status==='pending')emit({error:'购买等待 Apple 批准，批准后权益自动更新'});await updateLedger(()=>{});}catch(error){emit({error:error instanceof Error?error.message:'购买失败'});}finally{emit({busy:false})}}
async function restore(){if(!nativeBillingAvailable())throw new Error('请在 iPhone App 中恢复购买');emit({busy:true,error:''});try{const result=await native.restore();emit({entitlement:normalizeEntitlement(result.entitlement)});await updateLedger(()=>{});}catch(error){emit({error:error instanceof Error?error.message:'恢复购买失败'});}finally{emit({busy:false})}}
export function useBilling(){
  const state=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot,()=>snapshot)
  useEffect(()=>{
    void refreshBilling()
    const refresh=()=>void refreshBilling()
    let observedDay=localDay()
    const timer=window.setInterval(()=>{
      const day=localDay()
      const expired=snapshot.entitlement.productId&&snapshot.entitlement.expiresAt&&Date.parse(snapshot.entitlement.expiresAt)<=Date.now()
      if(day!==observedDay||expired){observedDay=day;refresh()}
    },30000)
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh)
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  },[])
  return {...state,checkIn,purchase,restore,refresh:refreshBilling}
}
