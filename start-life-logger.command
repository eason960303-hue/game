#!/bin/zsh
# Life Logger 一鍵啟動：Ollama（AI 日記）＋ cloudflared（公開網址）＋ 後端（含寄信）
# 用法：在 Finder 對這個檔案按兩下，或在終端機執行  ./start-life-logger.command
# 停止：執行 stop-life-logger.command

set -u
BACKEND="/Users/ding/Desktop/game/backend"
PY="/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python"
MAIL_ENV="$HOME/.config/life-logger/mail.env"
LOGDIR="$HOME/.config/life-logger/logs"
MODEL="qwen2.5:3b"
mkdir -p "$LOGDIR"

echo "==> Life Logger 啟動中..."

# 1) Ollama（本機 AI）
if ! curl -s -m 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "    啟動 Ollama..."
  brew services start ollama >/dev/null 2>&1
  for i in {1..20}; do
    curl -s -m 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break
    sleep 1
  done
fi
if curl -s -m 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "    Ollama OK"
  if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
    echo "    下載模型 $MODEL（第一次較久）..."
    ollama pull "$MODEL"
  fi
else
  echo "    ⚠ Ollama 沒起來，AI 日記會無法使用（其他功能正常）"
fi

# 2) 寄信設定
if [ -f "$MAIL_ENV" ]; then
  set -a; . "$MAIL_ENV"; set +a
  echo "    寄信設定已載入（${SMTP_FROM:-?}）"
else
  echo "    ⚠ 找不到 $MAIL_ENV，忘記密碼／驗證信功能會關閉"
fi

# 3) 關掉舊的後端與通道
echo "    關閉舊程序..."
OLD=$(lsof -nP -tiTCP:8000 -sTCP:LISTEN 2>/dev/null)
[ -n "$OLD" ] && kill $OLD 2>/dev/null
pkill -f 'cloudflared tunnel --url http://127.0.0.1:8000' 2>/dev/null
sleep 2

# 4) 啟動 cloudflared，抓取公開網址
echo "    建立公開網址（cloudflared）..."
TUN_LOG="$LOGDIR/cloudflared.log"
: > "$TUN_LOG"
nohup cloudflared tunnel --url http://127.0.0.1:8000 >>"$TUN_LOG" 2>&1 &
URL=""
for i in {1..30}; do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUN_LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "    ✗ 取得公開網址失敗，請查看 $TUN_LOG"
  exit 1
fi
echo "    公開網址：$URL"

# 5) 啟動後端（帶入網址、AI、寄信設定）
echo "    啟動後端..."
BK_LOG="$LOGDIR/backend.log"
PUBLIC_BASE_URL="$URL" RELOAD=false \
AI_API_BASE_URL="http://127.0.0.1:11434/v1" AI_API_KEY="ollama" AI_MODEL="$MODEL" \
nohup "$PY" "$BACKEND/main.py" >>"$BK_LOG" 2>&1 &
for i in {1..15}; do
  curl -s -m 2 http://127.0.0.1:8000/ >/dev/null 2>&1 && break
  sleep 1
done

if curl -s -m 3 http://127.0.0.1:8000/ >/dev/null 2>&1; then
  echo ""
  echo "✅ 啟動完成！把這個網址分享給朋友（每次啟動都會變）："
  echo ""
  echo "    $URL"
  echo ""
  echo "（要關閉請執行 stop-life-logger.command）"
else
  echo "    ✗ 後端沒起來，請查看 $BK_LOG"
  exit 1
fi
