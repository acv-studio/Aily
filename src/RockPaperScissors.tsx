import { useRef, useState } from 'react'
import { useI18n } from './i18n'

export type Move = '石头' | '剪刀' | '布'
type Phase = 'promise' | 'play' | 'result'
export function decideWinner(user: Move, character: Move) { if (user === character) return 'draw'; return (user === '石头' && character === '剪刀') || (user === '剪刀' && character === '布') || (user === '布' && character === '石头') ? 'user' : 'character' }
const moves: Move[] = ['石头', '剪刀', '布']
function randomMove():Move { const values=new Uint32Array(1);crypto.getRandomValues(values);return moves[values[0]%moves.length] }

export default function RockPaperScissors({ characterName, onComplete, onClose, temporary = false }:{characterName:string;onComplete:(summary:string)=>void|Promise<void>;onClose:()=>void;temporary?:boolean}) {
 const { t }=useI18n();const [phase,setPhase]=useState<Phase>('promise');const [promise,setPromise]=useState<Move|null>(null);const [actual,setActual]=useState<Move|null>(null);const [characterPromise]=useState<Move>(randomMove);const [characterActual]=useState<Move>(randomMove)
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');const savePending=useRef(false),saved=useRef(false)
 const result=actual?decideWinner(actual,characterActual):null
 const choosePromise=(move:Move)=>{setPromise(move);setPhase('play')}
 const chooseActual=(move:Move)=>{setActual(move);setPhase('result')}
 const saveResult=async()=>{
   if(!actual||savePending.current)return
   if(temporary||saved.current){onClose();return}
   savePending.current=true;setSaving(true);setSaveError('')
   try{await onComplete(t('和{name}猜拳：承诺出{promise}，实际出{move}，{result}',{name:t(characterName),promise:t(promise||''),move:t(actual),result:t(result==='draw'?'平局':result==='user'?'你赢了':'TA 赢了')}));saved.current=true;onClose()}
   catch(failure){setSaveError(failure instanceof Error?failure.message:t('回忆未保存，请重试'))}
   finally{savePending.current=false;setSaving(false)}
 }
 return <div className="game-overlay"><section className="game-sheet glass"><header><div><small>{t('聊天内小游戏')}</small><h2>{t('两次出手的小心机')}</h2></div><button aria-label={t('关闭小游戏')} disabled={saving} onClick={onClose}>×</button></header><div className="game-steps"><span className={phase==='promise'?'active':''}>{t('1 承诺')}</span><i/><span className={phase==='play'?'active':''}>{t('2 出手')}</span><i/><span className={phase==='result'?'active':''}>{t('3 揭晓')}</span></div>{phase==='promise'&&<><p>{t('{name} 已承诺出 {move}。你先说好准备出什么？',{name:t(characterName),move:t(characterPromise)})}</p><MoveButtons onChoose={choosePromise}/></>}{phase==='play'&&<><p>{t('你承诺出 {move}。现在提交真正的出手，提交后双方同时揭晓。',{move:t(promise||'')})}</p><MoveButtons onChoose={chooseActual}/></>}{phase==='result'&&actual&&<div className="game-result"><div><span>{t(characterName)}</span><strong>{t(characterActual)}</strong><small>{t(characterActual===characterPromise?'守信':'变招')}</small></div><b>VS</b><div><span>{t('你')}</span><strong>{t(actual)}</strong><small>{t(actual===promise?'守信':'变招')}</small></div><h3>{t(result==='draw'?'默契平局':result==='user'?'这次你赢了':'这次 TA 赢了')}</h3><p>{t(result==='user'?'行，今天听你的。':result==='draw'?'还挺有默契。再来一局？':'下次要不要换个策略？')}</p>{saveError&&<p role="alert">{saveError}</p>}{temporary&&<p>{t('临时会话不能保存长期记忆')}</p>}<button className="game-done" disabled={saving} onClick={()=>void saveResult()}>{temporary?t('关闭小游戏'):saving?t('正在保存…'):saveError?t('重试保存回忆'):t('收下这段回忆')}</button></div>}<footer>{t('双方的承诺与实际出手都在各阶段前锁定 · 每局随机，不会预判你的选择')}</footer></section></div>
}
function MoveButtons({onChoose}:{onChoose:(move:Move)=>void}){const {t}=useI18n();return <div className="move-buttons">{moves.map((move,index)=><button key={move} onClick={()=>onChoose(move)}><span aria-hidden="true">{['✊','✌️','✋'][index]}</span>{t(move)}</button>)}</div>}
