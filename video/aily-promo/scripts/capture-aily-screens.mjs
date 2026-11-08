import { chromium } from '../../node_modules/playwright/index.mjs'
import { copyFile, mkdir } from 'node:fs/promises'
const url=process.env.AILY_URL||'http://127.0.0.1:5174'
const out=new URL('../public/screenshots/',import.meta.url)
await mkdir(out,{recursive:true})
await copyFile(new URL('../../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',import.meta.url),new URL('aily-icon.png',out))
const browser=await chromium.launch({headless:true})
try{
 const context=await browser.newContext({viewport:{width:402,height:874},deviceScaleFactor:2,isMobile:true,hasTouch:true,reducedMotion:'reduce',timezoneId:'Asia/Shanghai',locale:'zh-CN',colorScheme:'dark',geolocation:{latitude:31.23,longitude:121.47},permissions:['geolocation']})
 const page=await context.newPage();page.setDefaultTimeout(10000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(url)
 await page.evaluate(async()=>{
  const {finishOnboarding,persistChatChanges,saveMemory}=await import('/src/db.ts')
  const {defaultOnboardingProfile}=await import('/src/onboarding.ts')
  const {acceptSafetyConsent}=await import('/src/privacy.ts')
  const {setThemePreference}=await import('/src/theme.ts')
  const {setExtensionInstalled}=await import('/src/extensionApps.ts')
  const profile={...defaultOnboardingProfile('lu'),userName:'小满',characterName:'陆听澜'}
  await finishOnboarding(profile,[]);acceptSafetyConsent();setThemePreference('dark')
  localStorage.setItem('aily.locale','zh-CN')
  for(const id of ['wardrobe','skincare-diary','photo-organizer','laughter-collector','gomoku','game-2048'])setExtensionInstalled(id,true)
  const now='2026-11-08T05:00:00.000Z'
  await persistChatChanges('lu',[
   {id:101,from:'character',text:'今天过得怎么样？慢慢说，我在听。',time:'21:08',createdAt:now,status:'sent'},
   {id:102,from:'user',text:'有点累，不过周末想去看展。',time:'21:09',createdAt:now,status:'sent'},
   {id:103,from:'character',text:'记得。周末看展，出门前我再提醒你带上充电宝。',time:'21:09',createdAt:now,status:'sent',memory:true},
   {id:104,from:'user',text:'还有，我不喜欢香菜。',time:'21:10',createdAt:now,status:'sent'},
   {id:105,from:'character',text:'收到。以后聊到吃饭，我会避开香菜。',time:'21:10',createdAt:now,status:'sent',memory:true}
  ])
  await saveMemory({id:'demo-memory-plan',characterId:'lu',text:'周末想去看展，出门前带充电宝',confirmedAt:now,updatedAt:now,category:'context',sourceMessageId:102,state:'confirmed',enabled:true,importance:4,pinned:true,originalText:'周末想去看展',language:'zh-CN',sensitive:false,conflictIds:[],topics:['计划','看展']})
  await saveMemory({id:'demo-memory-food',characterId:'lu',text:'不喜欢香菜',confirmedAt:now,updatedAt:now,category:'profile',sourceMessageId:104,state:'confirmed',enabled:true,importance:3,pinned:false,originalText:'我不喜欢香菜',language:'zh-CN',sensitive:false,conflictIds:[],topics:['饮食','偏好']})
 })
 await page.reload();await page.getByRole('button',{name:/与陆听澜聊天/}).waitFor()
 await page.screenshot({path:new URL('home.png',out).pathname})
 await page.getByRole('button',{name:/与陆听澜聊天/}).click();await page.getByRole('textbox',{name:'发消息'}).waitFor()
 await page.screenshot({path:new URL('chat-memory.png',out).pathname})
 await page.getByRole('button',{name:'返回消息'}).click();await page.getByRole('button',{name:'记忆',exact:true}).click()
 await page.getByText('不喜欢香菜',{exact:true}).waitFor();await page.screenshot({path:new URL('memory-manage.png',out).pathname})
 await page.getByRole('button',{name:'消息',exact:true}).click();await page.getByRole('button',{name:'应用商店',exact:true}).click()
 await page.getByRole('region',{name:'应用商店目录'}).waitFor();await page.screenshot({path:new URL('app-store.png',out).pathname})
 if(errors.length)throw new Error(`Page errors: ${errors.join('; ')}`)
 console.log('Captured Aily screenshots:',new URL('.',out).pathname)
 await context.close()
}finally{await browser.close()}
