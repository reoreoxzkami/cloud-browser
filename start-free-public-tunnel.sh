#!/bin/bash
# ==============================================================================
# クレジットカード一切不要！完全無料の外部公開ツール
# ==============================================================================
set -e

echo "=============================================================================="
echo "🚀 クレジットカード登録不要！無料外部公開ランチャー"
echo "=============================================================================="
echo "ご利用になりたい公開方法を選択してください:"
echo ""
echo " [1] Cloudflare Quick Tunnel (おすすめ・クレカ/アカウント完全不要・帯域無制限)"
echo " [2] Localtunnel (クレカ/アカウント完全不要・好きなサブドメイン名を指定可能)"
echo " [3] Ngrok (クレカ不要・固定無料ドメイン利用可能)"
echo " [4] 24時間常時バックグラウンド起動 (systemd / サービス化)"
echo ""

read -p "選択 [1/2/3/4] (デフォルト: 1): " METHOD
METHOD=${METHOD:-1}

if [ "$METHOD" = "1" ]; then
  echo ""
  echo "⚡ Cloudflare Quick Tunnel を起動します..."
  echo "※ アカウント登録もクレジットカードも一切不要です。"
  echo "※ 表示された 'https://xxxx.trycloudflare.com' のURLをブラウザで開いてください。"
  echo "------------------------------------------------------------------------------"
  cloudflared tunnel --url http://localhost:3000

elif [ "$METHOD" = "2" ]; then
  echo ""
  read -p "希望するサブドメイン名を入力 (例: my-cloud-browser-999): " SUBDOMAIN
  echo ""
  echo "⚡ Localtunnel を起動します..."
  if [ -n "$SUBDOMAIN" ]; then
    npx --yes localtunnel --port 3000 --subdomain "$SUBDOMAIN"
  else
    npx --yes localtunnel --port 3000
  fi

elif [ "$METHOD" = "3" ]; then
  echo ""
  echo "👉 Ngrok (https://ngrok.com/) で無料サインアップ (GitHub連携でクレカ不要) し、"
  echo "   [Your Authtoken] に表示されるトークンを入力してください:"
  read -p "Ngrok Authtoken: " NGROK_TOKEN
  if [ -n "$NGROK_TOKEN" ]; then
    npx --yes ngrok config add-authtoken "$NGROK_TOKEN"
  fi
  read -p "固定ドメインをお持ちの場合は入力 (無ければ空欄でEnter): " NGROK_DOMAIN
  if [ -n "$NGROK_DOMAIN" ]; then
    npx --yes ngrok http 3000 --domain="$NGROK_DOMAIN"
  else
    npx --yes ngrok http 3000
  fi

elif [ "$METHOD" = "4" ]; then
  echo ""
  echo "⚙️ PC起動時に自動でバックグラウンド常時公開する systemd サービスを作成します..."
  SERVICE_FILE="/etc/systemd/system/cloud-browser-tunnel.service"
  sudo bash -c "cat << UNIT > $SERVICE_FILE
[Unit]
Description=Cloud Browser Free Tunnel
After=network.target docker.service

[Service]
Type=simple
User=$USER
ExecStart=/usr/local/bin/cloudflared tunnel --url http://localhost:3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT"

  sudo systemctl daemon-reload
  sudo systemctl enable cloud-browser-tunnel
  sudo systemctl restart cloud-browser-tunnel

  sleep 3
  echo "=============================================================================="
  echo "🎉 24時間常時公開サービスが起動しました！"
  echo "📊 ログ確認コマンド: sudo journalctl -u cloud-browser-tunnel -f"
  echo "=============================================================================="
fi
