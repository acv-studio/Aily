import type {CSSProperties,ReactNode} from "react";
import {Img,staticFile} from "remotion";

export const ailyColors={bg:"#110f16",panel:"#1c1821",ink:"#f6f0f3",muted:"#aaa0ac",purple:"#b99bcf",violet:"#b8a4ea",mint:"#8fe1c1",pink:"#d4a8bd"};

export const Eyebrow=({children,monoFontFamily}:{children:ReactNode;monoFontFamily:string})=><div style={{fontFamily:monoFontFamily,letterSpacing:"0.26em",fontSize:18,fontWeight:700,color:ailyColors.purple,textTransform:"uppercase"}}>{children}</div>;

export const GlassCard=({children,style}:{children:ReactNode;style?:CSSProperties})=><div style={{background:"linear-gradient(145deg,rgba(255,255,255,.09),rgba(255,255,255,.035))",border:"1px solid rgba(255,255,255,.13)",boxShadow:"0 24px 80px rgba(0,0,0,.32), inset 0 1px rgba(255,255,255,.08)",borderRadius:28,...style}}>{children}</div>;

export const PhoneFrame=({src,width=410,style}:{src:string;width?:number;style?:CSSProperties})=><div style={{width,borderRadius:56,padding:12,background:"linear-gradient(150deg,#3c3443,#17131b)",border:"1px solid rgba(255,255,255,.2)",boxShadow:"0 35px 100px rgba(0,0,0,.52),0 0 90px rgba(185,155,207,.16)",...style}}><div style={{position:"relative",overflow:"hidden",borderRadius:45,background:"#110f16",aspectRatio:"402 / 874"}}><Img src={staticFile(src)} style={{width:"100%",height:"100%",objectFit:"cover"}}/><div style={{position:"absolute",inset:0,boxShadow:"inset 0 0 0 1px rgba(255,255,255,.08)",borderRadius:45}}/></div></div>;

export const Pill=({children,color=ailyColors.purple}:{children:ReactNode;color?:string})=><span style={{display:"inline-flex",alignItems:"center",padding:"10px 18px",borderRadius:999,border:`1px solid ${color}55`,background:`${color}18`,color,fontSize:18,fontWeight:600}}>{children}</span>;

export const Metric=({value,label,color=ailyColors.purple,monoFontFamily}:{value:string;label:string;color?:string;monoFontFamily:string})=><GlassCard style={{padding:"30px 34px"}}><div style={{fontFamily:monoFontFamily,fontSize:68,fontWeight:800,lineHeight:1,color,letterSpacing:"-.06em"}}>{value}</div><div style={{marginTop:14,fontSize:20,color:ailyColors.muted}}>{label}</div></GlassCard>;
