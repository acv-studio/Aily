import {AbsoluteFill,Img,interpolate,spring,staticFile,useCurrentFrame,useVideoConfig} from "remotion";
import {BackgroundOrbs,orbPresets,Eyebrow,PhoneFrame,ailyColors} from "../components";
import type {BaseSceneProps} from "../types/scene";
import {fadeIn} from "../utils/animations";

export const Scene1Origin=({monoFontFamily}:BaseSceneProps)=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();
 const enter=spring({frame,fps,config:{damping:22,stiffness:95}});
 const title=fadeIn(frame,.25*fps,.9*fps);const phone=spring({frame,fps,delay:12,config:{damping:24,stiffness:90}});
 const drift=interpolate(frame,[0,105],[0,-12]);
 return <AbsoluteFill style={{background:ailyColors.bg,color:ailyColors.ink,overflow:"hidden"}}>
  <BackgroundOrbs orbs={orbPresets.triColor}/>
  <div style={{position:"absolute",inset:"0 0 0 0",display:"grid",gridTemplateColumns:"1.08fr .92fr",alignItems:"center",padding:"70px 125px",gap:70,zIndex:2}}>
   <div style={{opacity:title,transform:`translateY(${(1-enter)*35}px)`}}>
    <div style={{display:"flex",alignItems:"center",gap:20,marginBottom:32}}><Img src={staticFile("screenshots/aily-icon.png")} style={{width:82,height:82,borderRadius:24,boxShadow:"0 18px 50px rgba(185,155,207,.32)"}}/><div><Eyebrow monoFontFamily={monoFontFamily}>PROJECT PREVIEW</Eyebrow><div style={{fontSize:28,fontWeight:700,marginTop:6}}>Aily</div></div></div>
    <h1 style={{fontSize:102,lineHeight:1.08,letterSpacing:"-.065em",fontWeight:850,maxWidth:900}}>我给 AI 做了<br/><span style={{background:"linear-gradient(100deg,#f6f0f3,#c9acd5 45%,#8fe1c1)",WebkitBackgroundClip:"text",color:"transparent"}}>一部小手机</span></h1>
    <p style={{fontSize:30,lineHeight:1.7,color:ailyColors.muted,marginTop:36,maxWidth:780}}>它会聊天，也会自动整理并记住重要的小事。<br/>还能安装应用，慢慢装进你的日常。</p>
    <div style={{display:"flex",gap:16,marginTop:42,fontFamily:monoFontFamily,color:ailyColors.muted,fontSize:17}}><span>LONG-TERM MEMORY</span><span>·</span><span>LOCAL FIRST</span><span>·</span><span>iOS + ANDROID</span></div>
   </div>
   <div style={{display:"flex",justifyContent:"center",transform:`translateY(${drift}px) scale(${.88+.12*phone})`,opacity:phone}}><PhoneFrame src="screenshots/home.png" width={426}/></div>
  </div>
 </AbsoluteFill>;
};
