#!/bin/bash
# ==============================================================================
# Cloudflare Pages への静的中継ポータル デプロイスクリプト
# ==============================================================================
set -e

PROJECT_NAME="${PAGES_PROJECT:-cloud-browser-portal}"
PORTAL_DIR="/tmp/portal-pages-dist"
rm -rf "$PORTAL_DIR"
mkdir -p "$PORTAL_DIR"

# 現在のトンネルURLを Worker API またはログから取得
CURRENT_URL=$(curl -s https://cloud-browser-portal.sannon2026.workers.dev/api/status | grep -o -E 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' || true)

if [ -z "$CURRENT_URL" ]; then
  CURRENT_URL=$(grep -o -E 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /tmp/cloudflared.log | tail -n 1 || true)
fi

echo "🌐 現在のトンネルURL: ${CURRENT_URL:-未接続}"

# HTML を生成
cat << HTML > "${PORTAL_DIR}/index.html"
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>⚡ Cloud Browser 中継ポータル</title>
  <meta http-equiv="refresh" content="3;url=${CURRENT_URL}">
  <style>
    body {
      background: #090d16;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: rgba(18, 26, 43, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 32px;
      max-width: 500px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    h1 { font-size: 22px; margin-bottom: 8px; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .url {
      background: rgba(0, 0, 0, 0.4);
      padding: 12px;
      border-radius: 10px;
      font-family: monospace;
      color: #38bdf8;
      word-break: break-all;
      margin-bottom: 24px;
      font-size: 13px;
    }
    .btn {
      display: inline-block;
      width: 100%;
      box-sizing: border-box;
      background: #2563eb;
      color: white;
      text-decoration: none;
      padding: 14px;
      border-radius: 12px;
      font-weight: bold;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ Cloud Browser 接続ポータル</h1>
    <p>Cloudflare Pages 中継ゲートウェイ</p>
    <div class="url">${CURRENT_URL:-トンネル接続待機中...}</div>
    <a href="${CURRENT_URL}" class="btn">クラウドブラウザを開く 🚀</a>
    <p style="font-size: 12px; color: #64748b;">3秒後に自動的にブラウザを開きます...</p>
  </div>
</body>
</html>
HTML

echo "🚀 Cloudflare CLI (wrangler pages) でデプロイ中..."
npx wrangler pages deploy "$PORTAL_DIR" --project-name "$PROJECT_NAME" --commit-dirty=true

echo "🎉 デプロイ完了！"
