#!/bin/bash
# ==============================================================================
# クレジットカード不要！URLがずっと変わらない【固定URL】永久無料セットアップ
# ==============================================================================
set -e

echo "=============================================================================="
echo "📌 URLが変わらない【固定URL】永久無料セットアップ（クレカ一切不要）"
echo "=============================================================================="
echo "おすすめの固定URL方式を選択してください:"
echo ""
echo " [1] Ngrok (一番おすすめ・公式永久固定ドメイン 'https://xxx.ngrok-free.app')"
echo " [2] Localtunnel (登録すら不要・好きな固定サブドメイン 'https://xxx.loca.lt')"
echo " [3] Playit.gg (登録簡単・永続固定URL)"
echo ""

read -p "選択 [1/2/3] (デフォルト: 1): " CHOICE
CHOICE=${CHOICE:-1}

if [ "$CHOICE" = "1" ]; then
  echo ""
  echo "=============================================================================="
  echo "🌟 Ngrok 永久固定ドメインの設定 (クレカ不要・所要時間1分)"
  echo "=============================================================================="
  echo "1. https://dashboard.ngrok.com/signup で無料アカウント作成 (GitHubログイン可・クレカ不要)"
  echo "2. [Domains] (https://dashboard.ngrok.com/domains) で 'Claim Domain' をクリックして固定ドメインを取得"
  echo "3. [Your Authtoken] (https://dashboard.ngrok.com/get-started/your-authtoken) からトークンをコピー"
  echo "------------------------------------------------------------------------------"
  
  read -p "👉 Ngrok の Authtoken を貼り付けてください: " NGROK_TOKEN
  if [ -z "$NGROK_TOKEN" ]; then
    echo "❌ トークンが入力されませんでした。"
    exit 1
  fi

  read -p "👉 取得した固定ドメイン (例: my-browser-xyz.ngrok-free.app): " NGROK_DOMAIN
  if [ -z "$NGROK_DOMAIN" ]; then
    echo "❌ ドメインが入力されませんでした。"
    exit 1
  fi

  # Ngrok のインストールと認証設定
  if ! command -v ngrok &> /dev/null; then
    echo "📥 ngrok をインストール中..."
    curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
    echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
    sudo apt update -qq && sudo apt install -y ngrok -qq
  fi

  ngrok config add-authtoken "$NGROK_TOKEN"

  # 24時間常時稼働 (systemd) サービスとして自動登録
  echo "⚙️ 24時間常時稼働サービス (systemd) として登録中..."
  SERVICE_FILE="/etc/systemd/system/cloud-browser-ngrok.service"
  sudo bash -c "cat << UNIT > $SERVICE_FILE
[Unit]
Description=Cloud Browser Permanent Ngrok Tunnel
After=network.target docker.service

[Service]
Type=simple
User=$USER
ExecStart=/usr/bin/ngrok http 3000 --domain=$NGROK_DOMAIN
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT"

  sudo systemctl daemon-reload
  sudo systemctl enable cloud-browser-ngrok
  sudo systemctl restart cloud-browser-ngrok

  echo "=============================================================================="
  echo "🎉 セットアップ完了！24時間ずっと変わらない固定URLで公開されました！"
  echo "🌐 あなたの永続固定URL: https://$NGROK_DOMAIN"
  echo "📊 サービス状態: $(sudo systemctl is-active cloud-browser-ngrok)"
  echo "=============================================================================="

elif [ "$CHOICE" = "2" ]; then
  echo ""
  echo "=============================================================================="
  echo "🌟 Localtunnel 固定サブドメインの設定 (アカウント登録すら不要)"
  echo "=============================================================================="
  read -p "👉 希望する固定サブドメイン (英数字・ハイフン): " LT_SUBDOMAIN
  LT_SUBDOMAIN=${LT_SUBDOMAIN:-cloud-browser-secure-$(shuf -i 1000-9999 -n 1)}

  SERVICE_FILE="/etc/systemd/system/cloud-browser-localtunnel.service"
  sudo bash -c "cat << UNIT > $SERVICE_FILE
[Unit]
Description=Cloud Browser Permanent Localtunnel
After=network.target docker.service

[Service]
Type=simple
User=$USER
ExecStart=/usr/bin/npx --yes localtunnel --port 3000 --subdomain $LT_SUBDOMAIN
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT"

  sudo systemctl daemon-reload
  sudo systemctl enable cloud-browser-localtunnel
  sudo systemctl restart cloud-browser-localtunnel

  echo "=============================================================================="
  echo "🎉 セットアップ完了！固定サブドメインで24時間公開されました！"
  echo "🌐 あなたの固定URL: https://${LT_SUBDOMAIN}.loca.lt"
  echo "=============================================================================="
fi
