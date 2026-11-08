#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
TOOLS="$PWD/.voice-tools"
if [ ! -d "$TOOLS/edge_tts" ]; then
  python3 -m pip install --disable-pip-version-check --target "$TOOLS" edge-tts
fi
export PYTHONPATH="$TOOLS"
OUT="$PWD/public/audio/voice"
mkdir -p "$OUT"
VOICE="zh-CN-XiaoxiaoNeural"
python3 -m edge_tts --voice "$VOICE" --rate=+18% --text '这是 Aily，一部为 AI 做的小手机。' --write-media "$OUT/scene-1.mp3"
python3 -m edge_tts --voice "$VOICE" --rate=+18% --text '它会聊天、自动记忆，还能安装应用和小游戏。' --write-media "$OUT/scene-2.mp3"
python3 -m edge_tts --voice "$VOICE" --rate=+20% --text '重要小事不用确认，会自动整理，也能随时修改或删除。' --write-media "$OUT/scene-3.mp3"
python3 -m edge_tts --voice "$VOICE" --rate=+15% --text '七天，一百三十五次提交，把想法变成能运行的产品。' --write-media "$OUT/scene-4.mp3"
python3 -m edge_tts --voice "$VOICE" --rate=+15% --text 'Aily，让陪伴走进日常。' --write-media "$OUT/scene-5.mp3"
ls -lh "$OUT"/scene-*.mp3
