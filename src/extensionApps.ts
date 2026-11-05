export type ExtensionAppId = 'focus-timer'|'skincare-diary'|'wardrobe'|'anniversary'|'gomoku'|'game-2048'
export type ExtensionApp = { id:ExtensionAppId; name:string; english:string; description:string; englishDescription:string; icon:string; color:string; category:'life'|'game' }
export const extensionApps:ExtensionApp[]=[
 {id:'focus-timer',name:'专注时钟',english:'Focus Timer',description:'简单的专注与休息计时工具',englishDescription:'A simple focus and break timer',icon:'⏱',color:'#ffb38f',category:'life'},
 {id:'skincare-diary',name:'护肤日记',english:'Skincare Diary',description:'记录护肤步骤、产品和肌肤状态',englishDescription:'Track routines, products and skin condition',icon:'🫧',color:'#f5a9c7',category:'life'},
 {id:'wardrobe',name:'穿搭衣橱',english:'Wardrobe',description:'整理衣物并组合每日穿搭',englishDescription:'Organize clothes and create outfits',icon:'👗',color:'#c8b2ff',category:'life'},
 {id:'anniversary',name:'纪念日助手',english:'Anniversary',description:'记录重要日期并查看倒数',englishDescription:'Save important dates and countdowns',icon:'💝',color:'#ff9da8',category:'life'},
 {id:'gomoku',name:'五子棋',english:'Gomoku',description:'本机双人五子棋',englishDescription:'Local two-player Gomoku',icon:'⚫',color:'#e6c38c',category:'game'},
 {id:'game-2048',name:'2048',english:'2048',description:'滑动合并数字方块',englishDescription:'Swipe and merge number tiles',icon:'🔢',color:'#e5a76f',category:'game'},
]
const key='aily.extension-apps.v1'
export function installedExtensionIds():ExtensionAppId[]{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(id=>extensionApps.some(app=>app.id===id)):[]}catch{return[]}}
export function setExtensionInstalled(id:ExtensionAppId,installed:boolean){const current=installedExtensionIds();const next=installed?[...new Set([...current,id])]:current.filter(item=>item!==id);localStorage.setItem(key,JSON.stringify(next));window.dispatchEvent(new CustomEvent('aily-extension-apps'));return next}
