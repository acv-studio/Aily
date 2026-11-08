import {AbsoluteFill,interpolate,staticFile} from "remotion";
import {Audio} from "@remotion/media";
import {TransitionSeries,linearTiming} from "@remotion/transitions";
import {fade} from "@remotion/transitions/fade";
import {z} from "zod";
import {Scene1Origin} from "./scenes/Scene1Origin";
import {Scene2Growth} from "./scenes/Scene2Growth";
import {Scene3Philosophy} from "./scenes/Scene3Philosophy";
import {Scene4Community} from "./scenes/Scene4Community";
import {Scene5Future} from "./scenes/Scene5Future";
import type {AilyMetrics} from "./types/scene";

export const CompositionSchema=z.object({fontFamily:z.string(),monoFontFamily:z.string(),repoUrl:z.string(),createdAt:z.string(),snapshotAt:z.string(),contributors:z.number(),pullRequests:z.number(),commits:z.number(),trackedFiles:z.number()});
export type CompositionProps=z.infer<typeof CompositionSchema>;
const DURATIONS={scene1:105,scene2:150,scene3:150,scene4:135,scene5:120};
const TRANSITION=15;
const Grain=()=> <div style={{position:"absolute",inset:0,zIndex:50,pointerEvents:"none",opacity:.025}}><svg width="100%" height="100%"><filter id="noise"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves={3} stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#noise)"/></svg></div>;
export const MyComposition=({fontFamily,monoFontFamily,repoUrl,createdAt,snapshotAt,contributors,pullRequests,commits,trackedFiles}:CompositionProps)=>{const metrics:AilyMetrics={visibility:"private",createdAt,snapshotAt,contributors,pullRequests,commits,trackedFiles};const timing=linearTiming({durationInFrames:TRANSITION});const sceneProps={monoFontFamily,metrics,repoUrl};return <AbsoluteFill style={{fontFamily,background:"#110f16"}}><Audio src={staticFile("audio/aily-ambient.wav")} volume={frame=>interpolate(frame,[0,30,540,600],[0,.14,.14,0],{extrapolateLeft:"clamp",extrapolateRight:"clamp"})}/><Grain/><TransitionSeries>
 <TransitionSeries.Sequence durationInFrames={DURATIONS.scene1}><Scene1Origin monoFontFamily={monoFontFamily}/></TransitionSeries.Sequence><TransitionSeries.Transition presentation={fade()} timing={timing}/>
 <TransitionSeries.Sequence durationInFrames={DURATIONS.scene2}><Scene2Growth monoFontFamily={monoFontFamily}/></TransitionSeries.Sequence><TransitionSeries.Transition presentation={fade()} timing={timing}/>
 <TransitionSeries.Sequence durationInFrames={DURATIONS.scene3}><Scene3Philosophy monoFontFamily={monoFontFamily}/></TransitionSeries.Sequence><TransitionSeries.Transition presentation={fade()} timing={timing}/>
 <TransitionSeries.Sequence durationInFrames={DURATIONS.scene4}><Scene4Community {...sceneProps}/></TransitionSeries.Sequence><TransitionSeries.Transition presentation={fade()} timing={timing}/>
 <TransitionSeries.Sequence durationInFrames={DURATIONS.scene5}><Scene5Future {...sceneProps}/></TransitionSeries.Sequence>
 </TransitionSeries></AbsoluteFill>};
export const TOTAL_DURATION=Object.values(DURATIONS).reduce((sum,value)=>sum+value,0)-4*TRANSITION;
