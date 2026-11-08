# Aily Promo Video

基于 `heimanba/oss-video-skill` 的 Remotion 五场景模板定制。

## Composition

- ID: `AilyPromo`
- 画布：1920 × 1080
- 帧率：30 fps
- 时长：600 帧 / 20 秒
- 环境音乐：`public/audio/aily-ambient.wav`，项目内生成的原创氛围音，低音量淡入淡出
- 普通话旁白：`public/audio/voice/scene-*.mp3`，`zh-CN-XiaoxiaoNeural` 女声，分场景混音

## 内容

1. Aily / AI 小手机概念与真实首页；
2. 聊天、自动长期记忆、应用商店和小游戏；
3. CHAT → ORGANIZE → RECALL 的自动记忆整理流程；
4. 真实私有仓库工程数据；
5. 本地优先产品愿景和关注开发进展 CTA。

## 真实数据来源

- GitHub 私有仓库信息：通过已登录 `gh` CLI 读取；
- 提交和文件数：当前本地 Git 仓库；
- 数据快照：2026-11-08；
- 135 commits / 710 tracked files / 26 PRs / 2 contributors；
- 不展示 1 Star / 0 Fork，不声称仓库已经公开开源；
- 完整采集说明见 `AILY-PROJECT-REPORT.md`。

## 产品截图

`public/screenshots/` 中的截图由 `scripts/capture-aily-screens.mjs` 在隔离的浏览器上下文里生成，只使用演示昵称、演示聊天和演示记忆，不读取用户现有浏览器资料。

## 重新生成

```bash
# 父项目保持 npm run dev，默认地址 http://127.0.0.1:5174
node scripts/capture-aily-screens.mjs

# 使用工作区内临时目录，避免受限环境写系统临时目录失败
mkdir -p .tmp .bun-cache
TMPDIR="$PWD/.tmp" BUN_INSTALL_CACHE_DIR="$PWD/.bun-cache" bun install
# 首次生成或修改旁白时运行（会在 .voice-tools 中安装 edge-tts）
scripts/synthesize-voiceover.sh

TMPDIR="$PWD/.tmp" bun run lint
TMPDIR="$PWD/.tmp" bunx remotion render src/index.ts AilyPromo out/Aily-Promo-1080p.mp4
```

渲染前可先输出关键帧检查：

```bash
TMPDIR="$PWD/.tmp" bunx remotion still src/index.ts AilyPromo out/scene-1.png --frame=45
TMPDIR="$PWD/.tmp" bunx remotion still src/index.ts AilyPromo out/scene-2.png --frame=165
TMPDIR="$PWD/.tmp" bunx remotion still src/index.ts AilyPromo out/scene-3.png --frame=315
TMPDIR="$PWD/.tmp" bunx remotion still src/index.ts AilyPromo out/scene-4.png --frame=450
TMPDIR="$PWD/.tmp" bunx remotion still src/index.ts AilyPromo out/scene-5.png --frame=555
```
