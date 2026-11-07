import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Undo2 } from 'lucide-react'
import type { Locale } from './i18n'
import { BOARD_SIZE, chooseGomokuMove, createGomokuBoard, hasGomokuWin, isGomokuDraw, type Player, type Stone } from './gomokuEngine'
import './gomokuApp.css'

type Move = { index:number; player:Player }
type Game = { board:Stone[]; history:Move[]; turn:Player; winner:0|Player; draw:boolean }
const empty = ():Game => ({board:createGomokuBoard(),history:[],turn:1,winner:0,draw:false})
const nextTurn = (history:Move[]):Player => history.length ? history[history.length-1].player === 1 ? 2 : 1 : 1
function place(game:Game,index:number):Game {
  if (game.winner || game.draw || game.board[index] !== 0) return game
  const board=[...game.board];board[index]=game.turn
  const winner=hasGomokuWin(board,index,game.turn)?game.turn:0
  return {board,history:[...game.history,{index,player:game.turn}],turn:game.turn===1?2:1,winner,draw:!winner&&isGomokuDraw(board)}
}
export default function GomokuApp({locale='zh-CN'}:{locale?:Locale}) {
  const en=locale==='en',copy=(zh:string,english:string)=>en?english:zh
  const [mode,setMode]=useState<'computer'|'local'>('computer'),[human,setHuman]=useState<Player>(1),[game,setGame]=useState<Game>(empty)
  const epoch=useRef(0)
  const computer:Player=human===1?2:1
  const thinking=mode==='computer'&&game.turn===computer&&!game.winner&&!game.draw
  const reset=()=>{epoch.current++;setGame(empty())}
  useEffect(()=>{
    if(!thinking)return
    const snapshot=game,generation=epoch.current
    const timer=window.setTimeout(()=>{
      if(generation!==epoch.current)return
      const move=chooseGomokuMove(snapshot.board,computer)
      if(move===null)return
      setGame(current=>current===snapshot&&generation===epoch.current?place(current,move):current)
    },260)
    return()=>window.clearTimeout(timer)
  },[thinking,game,computer])
  const humanMove=(index:number)=>setGame(current=>mode==='computer'&&current.turn!==human?current:place(current,index))
  const canUndo=mode==='local'?game.history.length>0:game.history.some(move=>move.player===human)
  const undo=()=>{
    if(!canUndo)return
    epoch.current++
    setGame(current=>{
      const history=[...current.history];history.pop()
      if(mode==='computer')while(history.length&&nextTurn(history)!==human)history.pop()
      const board=createGomokuBoard();history.forEach(move=>{board[move.index]=move.player})
      return{board,history,turn:nextTurn(history),winner:0,draw:false}
    })
  }
  const status=game.winner?mode==='computer'?game.winner===human?copy('你赢了！','You win!'):copy('电脑获胜，再来一局吧','Computer wins — try again'):copy(`${game.winner===1?'黑':'白'}方获胜`,`${game.winner===1?'Black':'White'} wins`):game.draw?copy('棋盘已满，这局平局','Board full — draw'):thinking?copy('电脑正在思考…','Computer is thinking…'):mode==='computer'?copy(`轮到你（${human===1?'黑':'白'}棋）`,`Your turn (${human===1?'black':'white'})`):copy(`轮到${game.turn===1?'黑':'白'}方`,`${game.turn===1?'Black':'White'} to move`)
  return <section className="gomoku-app gomoku-computer-app" aria-label={copy('五子棋对局','Gomoku game')}>
    <div className="gomoku-mode-row"><div className="gomoku-modes" role="group" aria-label={copy('对战模式','Game mode')}><button type="button" aria-pressed={mode==='computer'} onClick={()=>{if(mode!=='computer'){setMode('computer');reset()}}}>{copy('人机对战','Vs computer')}</button><button type="button" aria-pressed={mode==='local'} onClick={()=>{if(mode!=='local'){setMode('local');reset()}}}>{copy('本机双人','Two players')}</button></div>{mode==='computer'&&<label>{copy('你的棋子','Your color')}<select value={human} onChange={event=>{setHuman(Number(event.target.value) as Player);reset()}}><option value={1}>{copy('黑棋 · 先手','Black · first')}</option><option value={2}>{copy('白棋 · 后手','White · second')}</option></select></label>}</div>
    <div className="game-status" role="status" aria-live="polite">{status}</div>
    <div className="gomoku-board">{game.board.map((stone,index)=><button type="button" key={index} aria-label={copy(`棋位 ${index+1}`,`Intersection ${index+1}`)} data-stone={stone} disabled={!!stone||!!game.winner||game.draw||thinking} onClick={()=>humanMove(index)}>{stone>0&&<i className={stone===1?'black':'white'}>{game.history.at(-1)?.index===index&&<span className="gomoku-last-move"/>}</i>}</button>)}</div>
    <div className="extension-functional-actions"><button type="button" disabled={!canUndo} onClick={undo}><Undo2 size={17}/>{copy('悔棋','Undo')}{mode==='computer'&&copy('（撤回一轮）',' (round)')}</button><button type="button" onClick={reset}><RotateCcw size={17}/>{copy('重新开始','New game')}</button></div>
    <p className="desktop-note">{copy('电脑在本机自动落子，不联网、不扣积分。连成五子或更多即获胜，不设禁手；切换模式或棋色会重开本局。','The computer plays locally: no network or credits. Five or more in a row wins, with no forbidden moves. Changing mode or color starts a new game.')}</p>
  </section>
}
