#!/bin/zsh
# Life Logger 關閉：停止後端與公開網址（Ollama 維持背景執行）
echo "==> 關閉 Life Logger..."
OLD=$(lsof -nP -tiTCP:8000 -sTCP:LISTEN 2>/dev/null)
if [ -n "$OLD" ]; then
  kill $OLD 2>/dev/null
  echo "    已停止後端"
else
  echo "    後端本來就沒在跑"
fi
if pkill -f 'cloudflared tunnel --url http://127.0.0.1:8000' 2>/dev/null; then
  echo "    已關閉公開網址"
else
  echo "    公開網址本來就沒在跑"
fi
echo "    Ollama 仍在背景（要停請執行：brew services stop ollama）"
echo "完成。"
