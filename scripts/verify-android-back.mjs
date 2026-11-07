import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
const adb = process.env.ADB || new URL('../.toolchains/android-sdk/platform-tools/adb', import.meta.url).pathname
const serial = process.env.ANDROID_SERIAL || 'emulator-5554'
const run = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' }).trim()
const out = new URL('../.mobile-build/android-back/', import.meta.url)
await mkdir(out, { recursive: true })
run('shell','am','start','-W','-n','com.aily.app/.MainActivity')
const pid = run('shell','pidof','com.aily.app').split(/\s+/)[0]
assert.ok(pid)
run('forward','tcp:9225',`localabstract:webview_devtools_remote_${pid}`)
const pages = await fetch('http://127.0.0.1:9225/json/list').then(response => response.json())
assert.ok(pages[0], 'No debuggable Android WebView')
// Android WebView lacks Browser context management; connect directly to its page.
const ws = new WebSocket(pages[0].webSocketDebuggerUrl)
await new Promise((resolve,reject) => { ws.addEventListener('open',resolve,{once:true}); ws.addEventListener('error',reject,{once:true}) })
let next=0
const pending=new Map()
ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const job=pending.get(message.id);if(job){pending.delete(message.id);clearTimeout(job.timer);message.error?job.reject(new Error(JSON.stringify(message.error))):job.resolve(message.result)}}})
const call=(method,params)=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Android WebView CDP timed out'))},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})
const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value}
const wait=async condition=>evaluate(`(async()=>{const deadline=Date.now()+5000;while(!(${condition})){if(Date.now()>deadline)throw new Error('UI condition did not settle');await new Promise(r=>setTimeout(r,50));}return true;})()`)
const click=async selector=>{assert.equal(await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true;})()`),true,selector)}
const state=()=>evaluate(`({chat:!!document.querySelector('.chat-screen'),home:!!document.querySelector('.desktop-home'),saver:!!document.querySelector('.resume-screensaver')})`)
const home=async()=>{await wait(`document.querySelector('.desktop-home') && !document.querySelector('.chat-screen') && !document.querySelector('.resume-screensaver')`);assert.deepEqual(await state(),{chat:false,home:true,saver:false})}
const openChat=async()=>{await click('.desktop-bot');await wait(`document.querySelector('.chat-screen') && !document.querySelector('.resume-screensaver')`)}
const systemBack=()=>run('shell','input','keyevent','4')
const screenshot=async name=>writeFile(new URL(name,out),execFileSync(adb,['-s',serial,'exec-out','screencap','-p']))
const result={}
try{
  await wait(`document.querySelector('.desktop-home') || document.querySelector('.chat-screen') || document.querySelector('.resume-screensaver')`)
  if((await state()).saver){systemBack();await home()}
  else if((await state()).chat){await click('.chat-header button[aria-label="返回消息"]');await home()}
  await openChat();systemBack();await home();result.systemBackHome=true
  await screenshot('home-after-system-back.png')
  await openChat();await click('.chat-header button[aria-label="返回消息"]');await home();result.arrowBackHome=true
  await openChat();await click('button[aria-label="聊天设置"]');await wait(`document.querySelector('.chat-settings-options')`)
  systemBack();await wait(`document.querySelector('.chat-screen') && !document.querySelector('.chat-settings-options')`)
  assert.equal((await state()).saver,false);systemBack();await home();result.menuBackBeforeChat=true
  await openChat()
  run('shell','input','keyevent','3')
  // Home animation can leave Activity PAUSED briefly. Wait for actual STOPPED,
  // rather than immediately reopening and testing another pause-only interruption.
  const stopDeadline=Date.now()+10000
  while(true){
    const activities=run('shell','dumpsys','activity','activities')
    const start=activities.indexOf('packageName=com.aily.app')
    const state=start<0?'':activities.slice(start).match(/\bstate=(\w+)/)?.[1]
    if(state==='STOPPED')break
    if(Date.now()>stopDeadline)throw new Error('Android Activity did not stop after Home')
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  run('shell','am','start','-W','-n','com.aily.app/.MainActivity')
  await wait(`document.querySelector('.resume-screensaver')`);result.realBackgroundShowsSaver=true
  await screenshot('screen-saver-on-resume.png')
  systemBack();await home();result.screenSaverBackHome=true
  await screenshot('home-after-screen-saver-back.png')
  await writeFile(new URL('results.json',out),JSON.stringify(result,null,2))
  console.log('PASS Android native navigation:',JSON.stringify(result))
}finally{ws.close()}
