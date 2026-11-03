import { useState } from 'react'

type Scene = 'start' | 'choice' | 'ending'

export default function InteractiveStory({ characterName, onComplete, onClose }:{characterName:string;onComplete:(summary:string)=>void;onClose:()=>void}) {
  const [scene,setScene]=useState<Scene>('start')
  const [choice,setChoice]=useState('')
  const choose=(value:string)=>{setChoice(value);setScene('ending');onComplete(`和${characterName}完成故事《下班后的晚饭》：${value}`)}
  return <div className="game-overlay"><section className="story-sheet glass"><header><div><small>共同故事 · 约 3 分钟</small><h2>下班后的晚饭</h2></div><button onClick={onClose}>×</button></header><div className="story-art"><span>{scene==='ending'?'✦':'⌁'}</span><p>{scene==='start'?'厨房的灯亮着，锅里传来细小的沸腾声。':scene==='choice'?`${characterName}回头看见你，手里还拿着汤勺。`:'窗外开始下雨，屋里只剩下碗筷轻碰的声音。'}</p></div>{scene==='start'&&<><p>“回来得正好。先洗手，汤马上好了。”</p><button className="story-next" onClick={()=>setScene('choice')}>推开厨房的门</button></>}{scene==='choice'&&<div className="story-choices"><button onClick={()=>choose('从背后抱住他，说今天很想他')}><strong>从背后抱住他</strong><span>“今天有点想你。”</span></button><button onClick={()=>choose('靠在门边，看他把晚饭做好')}><strong>靠在门边看他</strong><span>“需要我帮忙吗？”</span></button></div>}{scene==='ending'&&<div className="story-ending"><small>你的选择</small><p>{choice}</p><h3>这一晚，被好好记住了</h3><p>{choice.startsWith('从背后')?'他停了一下，空着的那只手覆上你的手背。“嗯。知道了，再抱会儿。”':'他把洗好的番茄递给你。“那就陪我。别偷吃凉的。”'}</p><button className="story-next" onClick={onClose}>收进回忆</button></div>}<footer>选择影响故事表达，不会导致关系失败</footer></section></div>
}
