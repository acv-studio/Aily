import "./index.css";
import {Composition} from "remotion";
import {MyComposition,TOTAL_DURATION,CompositionSchema} from "./Composition";
const mainFont='"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",sans-serif';
const monoFont='"SFMono-Regular",Menlo,Monaco,Consolas,monospace';
export const RemotionRoot=()=> <Composition id="AilyPromo" component={MyComposition} schema={CompositionSchema} durationInFrames={TOTAL_DURATION} fps={30} width={1920} height={1080} defaultProps={{fontFamily:mainFont,monoFontFamily:monoFont,repoUrl:"https://github.com/acv-studio/Aily",createdAt:"2026-11-01",snapshotAt:"2026-11-08",contributors:2,pullRequests:26,commits:135,trackedFiles:710}}/>;
export {mainFont,monoFont};
