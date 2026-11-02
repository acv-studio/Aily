import { useMemo, useState } from 'react'

export type Move = '石头' | '剪刀' | '布'
type Phase = 'promise' | 'play' | 'result'

export function decideWinner(user: Move, character: Move) {
  if (user === character) return 'draw'
  return (user === '石头' && character === '剪刀') || (user === '剪刀' && character === '布') || (user === '布' && character === '石头') ? 'user' : 'character'
}

const moves: Move[] = ['石头', '剪刀', '布']
const counter: Record<Move, Move> = { 石头: '布', 剪刀: '石头', 布: '剪刀' }

export default function RockPaperScissors({ characterName, onComplete, onClose }:{characterName:string;onComplete:(summary:string)=>void;onClose:()=>void}) {
  const [phase,setPhase]=useState<Phase>('promise')
  const [promise,setPromise]=useState<Move|null>(null)
  const [actual,setActual]=useState<Move|null>(null)
  const characterPromise:Move='石头'
  const characterActual=useMemo<Move>(()=>promise ? counter[promise] : '剪刀',[promise])
  const result=actual?decideWinner(actual,characterActual):null
  const choosePromise=(move:Move)=>{setPromise(move);setPhase('play')}
  const chooseActual=(move:Move)=>{setActual(move);setPhase('result');const winner=decideWinner(move,characterActual);onComplete(`和${characterName}猜拳：承诺出${promise}，实际出${move}，${winner==='draw'?'平局':winner==='user'?'你赢了':'他赢了'}`)}
  return <div className="game-overlay"><section className="game-sheet glass"><header><div><small>聊天内小游戏</small><h2>两次出手的小心机</h2></div><button onClick={onClose}>×</button></header><div className="game-steps"><span className={phase==='promise'?'active':''}>1 承诺</span><i/><span className={phase==='play'?'active':''}>2 出手</span><i/><span className={phase==='result'?'active':''}>3 揭晓</span></div>{phase==='promise'&&<><p>{characterName} 已经承诺出 <strong>{characterPromise}</strong>。你先说好准备出什么？</p><MoveButtons onChoose={choosePromise}/></>}{phase==='play'&&<><p>你承诺出 <strong>{promise}</strong>。现在提交真正的出手，提交后双方同时揭晓。</p><MoveButtons onChoose={chooseActual}/></>}{phase==='result'&&actual&&<div className="game-result"><div><span>你</span><strong>{actual}</strong><small>{actual===promise?'守信':'变招'}</small></div><b>VS</b><div><span>{characterName}</span><strong>{characterActual}</strong><small>{characterActual===characterPromise?'守信':'变招'}</small></div><h3>{result==='draw'?'默契平局':result==='user'?'这次你赢了':'被他预判到了'}</h3><p>{result==='user'?'行，今天听你的。':result==='draw'?'还挺有默契。再来一局？':'说好出石头，临时变招？'}</p><button className="game-done" onClick={onClose}>收下这段回忆</button></div>}<footer>结果由提交时锁定 · 不付费改结果</footer></section></div>
}

function MoveButtons({onChoose}:{onChoose:(move:Move)=>void}) { return <div className="move-buttons">{moves.map((move,index)=><button key={move} onClick={()=>onChoose(move)}><span>{['✊','✌️','✋'][index]}</span>{move}</button>)}</div> }
