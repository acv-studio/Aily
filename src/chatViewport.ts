export type ChatViewportMetrics = {
  layoutHeight:number
  visualHeight?:number
  visualTop?:number
  nativeKeyboardHeight?:number
  fullHeight?:number
}
export function calculateChatViewport(metrics:ChatViewportMetrics) {
  const positive=(value:number|undefined,fallback:number)=>Number.isFinite(value)&&Number(value)>0?Number(value):fallback
  const layout=positive(metrics.layoutHeight,1)
  const visual=positive(metrics.visualHeight,layout)
  const offset=Number.isFinite(metrics.visualTop)?Math.max(0,Number(metrics.visualTop)):0
  const keyboard=Number.isFinite(metrics.nativeKeyboardHeight)?Math.max(0,Number(metrics.nativeKeyboardHeight)):0
  const full=metrics.fullHeight===0?0:positive(metrics.fullHeight,layout)
  // Native resize and visualViewport can report the SAME occlusion. Use the
  // smallest bottom boundary; never subtract keyboard height from an already
  // shortened WebView/visual viewport a second time.
  const bottom=Math.max(1,Math.min(layout,offset+visual,keyboard>0&&full>0?Math.max(1,full-keyboard):Infinity))
  const top=Math.min(offset,Math.max(0,bottom-1))
  return {top,height:Math.max(1,bottom-top),keyboardOpen:keyboard>0||layout-(offset+visual)>120}
}
