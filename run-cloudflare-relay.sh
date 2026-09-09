#!/bin/bash
# ==============================================================================
# Cloudflare Quick Tunnel 24時間常駐 ＆ 中継ポータル自動更新デーモン
# ==============================================================================

PORT="${PORT:-3000}"
PORTAL_URL="https://cloud-browser-portal.sannon2026.workers.dev"
UPDATE_TOKEN="82bc0a571e659581657a3df36d794432"
LOG_FILE="/tmp/cloudflared.log"
CURRENT_URL=""

echo "=============================================================================="
echo "🚀 Starting Cloudflare Tunnel & Portal Auto-Sync Daemon"
echo "🔌 Target Local Port:  http://localhost:${PORT}"
echo "🌐 Fixed Portal URL:   ${PORTAL_URL}"
echo "📝 Tunnel Log File:    ${LOG_FILE}"
echo "=============================================================================="

cleanup() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🛑 停止シグナルを受信しました。プロセスを終了します..."
  if [ -n "$CF_PID" ]; then
    kill "$CF_PID" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup SIGINT SIGTERM

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚡ Cloudflare Tunnel を起動しています..."
  rm -f "${LOG_FILE}"
  touch "${LOG_FILE}"

  # cloudflared 起動
  cloudflared tunnel --url "http://localhost:${PORT}" >> "${LOG_FILE}" 2>&1 &
  CF_PID=$!

  TUNNEL_URL=""
  WAIT_COUNT=0
  MAX_WAIT=40

  # URLが発行されるまでログをポーリング
  while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    
    # ログから https://*.trycloudflare.com を抽出
    FOUND_URL=$(grep -o -E 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "${LOG_FILE}" | head -n 1)
    if [ -n "$FOUND_URL" ]; then
      TUNNEL_URL="$FOUND_URL"
      break
    fi

    # プロセスが死んでいないか確認
    if ! kill -0 "$CF_PID" 2>/dev/null; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ cloudflared プロセスが早期終了しました。ログ:"
      tail -n 10 "${LOG_FILE}"
      break
    fi
  done

  if [ -n "$TUNNEL_URL" ]; then
    CURRENT_URL="$TUNNEL_URL"
    echo "------------------------------------------------------------------------------"
    echo "🎉 トンネルURLを発行しました: ${CURRENT_URL}"
    echo "📡 中継ポータルに最新URLを送信中..."

    # 中継ポータルの KV に最新URLを登録
    RESP=$(curl -s -m 10 -X POST "${PORTAL_URL}/api/update" \
      -H "Content-Type: application/json" \
      -d "{\"url\":\"${CURRENT_URL}\",\"token\":\"${UPDATE_TOKEN}\"}")
    
    echo "✅ 中継ポータル更新完了: ${RESP}"
    echo "🌟 固定アクセス先: ${PORTAL_URL}"
    echo "------------------------------------------------------------------------------"

    # 死活監視ループ (トンネルが生きている限りここで維持)
    FAIL_COUNT=0
    while kill -0 "$CF_PID" 2>/dev/null; do
      sleep 30
      
      # 30秒ごとにヘルスチェック
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 8 "${CURRENT_URL}/healthz" 2>/dev/null || echo "000")
      if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
        FAIL_COUNT=0
      else
        FAIL_COUNT=$((FAIL_COUNT + 1))
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ [Keep-Alive] 応答異常 (HTTP ${HTTP_CODE}, 連続${FAIL_COUNT}回)"
        if [ $FAIL_COUNT -ge 3 ]; then
          echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔄 3回連続で失敗したためトンネルを再起動します..."
          kill "$CF_PID" 2>/dev/null || true
          break
        fi
      fi
    done
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ トンネルURLの取得に失敗しました。5秒後に再試行します..."
    kill "$CF_PID" 2>/dev/null || true
  fi

  sleep 5
done
