import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Mic, MicOff, Phone, Square, Volume2 } from 'lucide-react'
import type { Character } from './data'
import type { ChatMessage } from './chatService'

type RecognitionEvent = Event & { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type RecognitionConstructor = new () => Recognition

declare global { interface Window { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor } }

export default function CallScreen({ character, messages, replying, send, close }:{character:Character;messages:ChatMessage[];replying:boolean;send:(options?:{text?:string})=>Promise<void>;close:()=>void}) {
  const [seconds,setSeconds]=useState(0)
  const [listening,setListening]=useState(false)
  const [muted,setMuted]=useState(false)
  const [transcript,setTranscript]=useState('')
  const [notice,setNotice]=useState('点击麦克风开始说话')
  const recognition=useRef<Recognition|null>(null)
  const lastSpoken=useRef<number|undefined>([...messages].reverse().find(item=>item.from==='character')?.id)
  const alive=useRef(true)

  useEffect(()=>{ const timer=window.setInterval(()=>setSeconds(value=>value+1),1000); return()=>window.clearInterval(timer) },[])
  useEffect(()=>()=>{ alive.current=false; recognition.current?.abort(); window.speechSynthesis?.cancel() },[])
  useEffect(()=>{
    if(replying) { setNotice('对方正在思考…'); return }
    const reply=[...messages].reverse().find(item=>item.from==='character'&&item.status==='sent'&&item.text)
    if(!reply||reply.id===lastSpoken.current)return
    lastSpoken.current=reply.id
    setTranscript(reply.text)
    setNotice(`${character.name} 正在说话`)
    if('speechSynthesis'in window){window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(reply.text);utterance.lang='zh-CN';utterance.rate=.96;utterance.onend=()=>alive.current&&setNotice('点击麦克风继续说话');window.speechSynthesis.speak(utterance)}
  },[messages,replying,character.name])

  const toggleListen=()=>{
    if(listening){recognition.current?.stop();setListening(false);return}
    if(muted){setNotice('请先取消静音');return}
    const Constructor=window.SpeechRecognition||window.webkitSpeechRecognition
    if(!Constructor){setNotice('当前浏览器不支持语音识别，请使用最新版 Chrome 或 Safari');return}
    window.speechSynthesis?.cancel()
    const instance=new Constructor(); recognition.current=instance
    instance.lang='zh-CN';instance.continuous=false;instance.interimResults=true
    instance.onresult=event=>{let text='';let final=false;for(let i=0;i<event.results.length;i++){text+=event.results[i][0].transcript;final=final||event.results[i].isFinal}setTranscript(text);setNotice(final?'正在发送…':'正在聆听…');if(final&&text.trim()){setListening(false);void send({text:text.trim()})}}
    instance.onerror=()=>{setListening(false);setNotice('没有听清，请点击麦克风重试')}
    instance.onend=()=>setListening(false)
    try{instance.start();setListening(true);setNotice('正在聆听…')}catch{setNotice('麦克风暂时不可用，请稍后重试')}
  }
  const hangup=()=>{recognition.current?.abort();window.speechSynthesis?.cancel();close()}
  const time=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`
  return <main className="call-screen" style={{'--accent':character.accent} as React.CSSProperties}>
    <button className="call-back" aria-label="返回聊天" onClick={hangup}><ArrowLeft/></button>
    <div className="call-glow"/><section className="call-person"><span className="call-avatar">{character.avatar}</span><p>与 AI 角色通话中</p><h1>{character.name}</h1><time>{time}</time></section>
    <section className="call-caption" aria-live="polite"><span>{notice}</span><p>{transcript||'你说的话和角色回答会显示在这里'}</p>{replying&&<i className="call-dots">•••</i>}</section>
    <footer className="call-controls"><button onClick={()=>setMuted(value=>!value)} className={muted?'active':''}><MicOff/><span>{muted?'已静音':'静音'}</span></button><button className={`call-mic ${listening?'listening':''}`} onClick={toggleListen} disabled={replying}>{listening?<Square/>:<Mic/>}<span>{listening?'停止':'说话'}</span></button><button onClick={()=>{setNotice('声音将通过当前设备播放')}}><Volume2/><span>扬声器</span></button></footer>
    <button className="hangup" onClick={hangup}><Phone className="hangup-icon"/><span>挂断</span></button>
    <p className="call-disclosure">语音由浏览器识别，回答由已配置的 AI 模型生成</p>
  </main>
}
