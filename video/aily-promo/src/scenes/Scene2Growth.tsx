import {AbsoluteFill,spring,useCurrentFrame,useVideoConfig} from "remotion";
import {BackgroundOrbs,Eyebrow,GlassCard,PhoneFrame,Pill,ailyColors} from "../components";
import type {BaseSceneProps} from "../types/scene";
import {createStaggerAnimation,fadeIn} from "../utils/animations";

const cards=[
 {tag:"MEMORY",title:"确认后再记住",text:"偏好、计划和重要话语，由你确认、修改、归档或删除。",color:ailyColors.purple},
 {tag:"APPS",title:"AI 也能装应用",text:"衣橱、护肤、音乐、相册整理、笑声收集器与小游戏。",color:ailyColors.mint},
 {tag:"PRIVACY",title:"临时会话隔离",text:"不落盘，不读取长期记忆；媒体内容默认只留在本机。",color:ailyColors.violet},
];
export const Scene2Growth=({monoFontFamily}:BaseSceneProps)=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const items=createStaggerAnimation(frame,cards.length,{baseStartFrame:18,staggerDelay:9,duration:22,offsetDistance:24});
 const left=fadeIn(frame,0,.65*fps);const phone1=spring({frame,fps,delay:10,config:{damping:24}});const phone2=spring({frame,fps,delay:24,config:{damping:24}});
 return <AbsoluteFill style={{background:ailyColors.bg,color:ailyColors.ink,overflow:"hidden"}}><BackgroundOrbs/>
  <div style={{position:"absolute",inset:0,padding:"66px 116px",display:"grid",gridTemplateColumns:"1fr 1.08fr",gap:64,zIndex:2}}>
   <div style={{paddingTop:28,opacity:left}}><Eyebrow monoFontFamily={monoFontFamily}>NOT JUST A CHATBOX</Eyebrow><h2 style={{fontSize:72,lineHeight:1.08,letterSpacing:"-.055em",marginTop:18}}>不只是<br/><span style={{color:ailyColors.purple}}>一个聊天框</span></h2><p style={{fontSize:25,lineHeight:1.7,color:ailyColors.muted,marginTop:26}}>陪伴、记忆和日常工具，<br/>都住进同一部 AI 小手机。</p>
    <div style={{display:"grid",gap:16,marginTop:34}}>{cards.map((card,i)=><GlassCard key={card.tag} style={{padding:"20px 24px",opacity:items[i].opacity,transform:`translateX(${-items[i].offset}px)`}}><div style={{display:"flex",alignItems:"center",gap:15}}><Pill color={card.color}>{card.tag}</Pill><strong style={{fontSize:25}}>{card.title}</strong></div><p style={{fontSize:18,lineHeight:1.6,color:ailyColors.muted,marginTop:12}}>{card.text}</p></GlassCard>)}</div>
   </div>
   <div style={{position:"relative",height:"100%"}}><div style={{position:"absolute",left:25,top:38,transform:`translateY(${(1-phone1)*45}px) rotate(-4deg) scale(${.9+.1*phone1})`,opacity:phone1}}><PhoneFrame src="screenshots/chat-memory.png" width={360}/></div><div style={{position:"absolute",right:10,top:8,transform:`translateY(${(1-phone2)*55}px) rotate(5deg) scale(${.9+.1*phone2})`,opacity:phone2}}><PhoneFrame src="screenshots/app-store.png" width={350}/></div></div>
  </div>
 </AbsoluteFill>;
};
