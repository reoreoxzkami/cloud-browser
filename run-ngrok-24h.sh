#!/bin/bash
# ==============================================================================
# ngrok 24時間常駐・停止防止自動オープン＆自動再接続スクリプト
# ==============================================================================

DOMAIN="${NGROK_DOMAIN:-judgingly-prize-chili.ngrok-free.dev}"
PORT="${PORT:-3000}"
LOG_FILE="/tmp/ngrok.log"
PING_INTERVAL="${PING_INTERVAL:-300}" # 5分ごと (300秒)

echo "=============================================================================="
echo "🚀 Starting 24/7 ngrok Auto-Reconnect & Keep-Alive Guard"
echo "🌐 Target Domain:   https://${DOMAIN}"
echo "🔌 Local Port:      http://localhost:${PORT}"
echo "🛡️ Keep-Alive Ping: Every ${PING_INTERVAL}s (Auto-Open)"
echo "📝 Log file:        ${LOG_FILE}"
echo "=============================================================================="

# バックグラウンドでの定期自動アクセス (停止防止 Keep-Alive ループ)
keep_alive_loop() {
  # 初回はトンネル起動を待って20秒後に開始
  sleep 20
  while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔄 [Keep-Alive] ngrokサイトにアクセスして停止を防止中: https://${DOMAIN}/healthz"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
      -H "ngrok-skip-browser-warning: 69420" \
      -H "User-Agent: CloudBrowser-KeepAlive/2.0" \
      "https://${DOMAIN}/healthz" 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ [Keep-Alive] 正常応答 (HTTP ${HTTP_CODE}) - トンネルアクティブ"
    else
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ [Keep-Alive] 応答異常 (HTTP ${HTTP_CODE}). トンネル再接続を促します..."
    fi
    sleep "${PING_INTERVAL}"
  done
}

# Keep-Alive ループをバックグラウンドで開始
keep_alive_loop &
KEEP_ALIVE_PID=$!

trap "kill $KEEP_ALIVE_PID 2>/dev/null; exit 0" SIGINT SIGTERM

while true; do
  # 既存のトンネルが動いていないか確認
  if ! pgrep -f "ngrok.*${PORT}" > /dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚡ Launching ngrok tunnel..."
    ngrok http ${PORT} --url=${DOMAIN} >> "${LOG_FILE}" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ ngrok process exited. Reconnecting in 3 seconds..."
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ ngrok is active."
  fi
  sleep 5
done
