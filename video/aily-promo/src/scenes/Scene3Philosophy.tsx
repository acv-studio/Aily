import {AbsoluteFill,interpolate,spring,useCurrentFrame,useVideoConfig} from "remotion";
import {BackgroundOrbs,Eyebrow,GlassCard,PhoneFrame,ailyColors} from "../components";
import type {BaseSceneProps} from "../types/scene";
import {fadeIn} from "../utils/animations";
const steps=[
 {id:"01",label:"CHAT",title:"聊天里出现重要小事",text:"偏好 · 计划 · 共同经历",color:ailyColors.pink},
 {id:"02",label:"CONFIRM",title:"由你确认是否留下",text:"分类 · 重要度 · 到期 · 纠错",color:ailyColors.purple},
 {id:"03",label:"RECALL",title:"未来对话按需召回",text:"相关记忆 + 周期摘要",color:ailyColors.mint},
];
export const Scene3Philosophy=({monoFontFamily}:BaseSceneProps)=>{const frame=useCurrentFrame();const {fps}=useVideoConfig();const title=fadeIn(frame,0,.65*fps);const phone=spring({frame,fps,delay:20,config:{damping:26}});const line=interpolate(frame,[18,98],[0,1],{extrapolateLeft:"clamp",extrapolateRight:"clamp"});return <AbsoluteFill style={{background:ailyColors.bg,color:ailyColors.ink,overflow:"hidden"}}><BackgroundOrbs/>
 <div style={{position:"absolute",inset:0,padding:"66px 120px",zIndex:2,display:"grid",gridTemplateColumns:"1.14fr .86fr",gap:70}}>
  <div style={{opacity:title}}><Eyebrow monoFontFamily={monoFontFamily}>USER-CONTROLLED MEMORY</Eyebrow><h2 style={{fontSize:70,lineHeight:1.12,letterSpacing:"-.055em",marginTop:18}}>记住之前，<br/><span style={{color:ailyColors.mint}}>先由你确认</span></h2><p style={{fontSize:23,lineHeight:1.65,color:ailyColors.muted,marginTop:22}}>长期记忆不是“什么都永久保存”，<br/>而是一条可查看、可修改、可删除的路径。</p>
   <div style={{position:"relative",display:"grid",gap:18,marginTop:34}}><div style={{position:"absolute",left:30,top:35,bottom:35,width:3,background:`linear-gradient(${ailyColors.pink},${ailyColors.purple},${ailyColors.mint})`,transform:`scaleY(${line})`,transformOrigin:"top",opacity:.65}}/>{steps.map((step,i)=>{const value=spring({frame,fps,delay:12+i*12,config:{damping:24}});return <GlassCard key={step.id} style={{padding:"18px 24px 18px 84px",position:"relative",opacity:value,transform:`translateX(${(1-value)*-28}px)`}}><div style={{position:"absolute",left:15,top:20,width:34,height:34,borderRadius:17,background:step.color,color:ailyColors.bg,fontFamily:monoFontFamily,fontSize:14,fontWeight:800,display:"grid",placeItems:"center"}}>{step.id}</div><div style={{fontFamily:monoFontFamily,color:step.color,fontSize:14,letterSpacing:".18em"}}>{step.label}</div><div style={{fontSize:23,fontWeight:750,marginTop:4}}>{step.title}</div><div style={{fontSize:17,color:ailyColors.muted,marginTop:5}}>{step.text}</div></GlassCard>})}</div>
  </div>
  <div style={{display:"flex",justifyContent:"center",alignItems:"center",opacity:phone,transform:`translateX(${(1-phone)*50}px)`}}><PhoneFrame src="screenshots/memory-manage.png" width={420}/></div>
 </div></AbsoluteFill>};
