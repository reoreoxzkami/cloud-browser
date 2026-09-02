#!/bin/bash
# ==============================================================================
# Cloudflare Named Tunnel 24時間常時稼働 完全自動セットアップスクリプト
# ==============================================================================
set -e

echo "=============================================================================="
echo "🌐 Cloudflare Named Tunnel 24時間常時稼働 セットアップ"
echo "=============================================================================="

# 1. cloudflared コマンドの確認
if ! command -v cloudflared &> /dev/null; then
  echo "📥 cloudflared をインストールしています..."
  curl -L --output cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x cloudflared
  sudo mv cloudflared /usr/local/bin/cloudflared
fi

echo ""
echo "セットアップ方法を選択してください:"
echo " [1] Cloudflare Zero Trust ダッシュボードのトークンを使う（最も簡単・推奨）"
echo " [2] CLI から直接ログインして作成（ドメイン設定自動化）"
echo " [3] Docker Compose 経由でバックグラウンド起動"
echo ""

read -p "選択 [1/2/3] (デフォルト: 1): " CHOICE
CHOICE=${CHOICE:-1}

if [ "$CHOICE" = "1" ]; then
  echo ""
  echo "👉 Cloudflare Zero Trust (https://one.dash.cloudflare.com/) の"
  echo "   [Networks] -> [Tunnels] -> [Create a Tunnel] で発行された"
  echo "   'TUNNEL_TOKEN' (eyJhIjoi... で始まる長い文字列) を貼り付けてください:"
  echo ""
  read -p "TUNNEL_TOKEN: " USER_TOKEN

  if [ -z "$USER_TOKEN" ]; then
    echo "❌ トークンが入力されませんでした。処理を中断します。"
    exit 1
  fi

  echo "TUNNEL_TOKEN=$USER_TOKEN" > .env
  
  echo "⚙️ systemd サービスとして 24時間自動起動登録中..."
  sudo cloudflared service install "$USER_TOKEN" || {
    echo "⚠️ systemd サービス登録済みの場合は再起動します..."
    sudo systemctl restart cloudflared
  }
  sudo systemctl enable cloudflared
  sudo systemctl start cloudflared

  echo ""
  echo "=============================================================================="
  echo "🎉 Cloudflare Named Tunnel が 24時間常時稼働サービスとして起動しました！"
  echo "📊 サービス状態: $(sudo systemctl is-active cloudflared)"
  echo "👉 Cloudflare ダッシュボードで [Public Hostname] に 'http://localhost:3000' を割り当ててください。"
  echo "=============================================================================="

elif [ "$CHOICE" = "2" ]; then
  echo "🔑 Cloudflare にログインします..."
  cloudflared tunnel login

  read -p "作成するトンネル名を入力 (デフォルト: cloud-browser): " TUNNEL_NAME
  TUNNEL_NAME=${TUNNEL_NAME:-cloud-browser}

  echo "📦 トンネル '$TUNNEL_NAME' を作成中..."
  cloudflared tunnel create "$TUNNEL_NAME"

  read -p "割り当てる公開ドメイン名を入力 (例: browser.yourdomain.com): " CUSTOM_DOMAIN
  if [ -n "$CUSTOM_DOMAIN" ]; then
    cloudflared tunnel route dns "$TUNNEL_NAME" "$CUSTOM_DOMAIN"
    echo "✅ DNS ルーティングを設定しました: $CUSTOM_DOMAIN -> $TUNNEL_NAME"
  fi

  echo "🚀 トンネルを 24時間常時稼働 (systemd) サービスとして登録中..."
  # 設定ファイル作成
  mkdir -p ~/.cloudflared
  cat << CONF > ~/.cloudflared/config.yml
tunnel: $TUNNEL_NAME
credentials-file: /root/.cloudflared/${TUNNEL_NAME}.json
ingress:
  - hostname: $CUSTOM_DOMAIN
    service: http://localhost:3000
  - service: http_status:404
CONF

  sudo cp ~/.cloudflared/config.yml /etc/cloudflared/config.yml 2>/dev/null || true
  sudo cloudflared service install || true
  sudo systemctl enable cloudflared
  sudo systemctl start cloudflared

  echo "=============================================================================="
  echo "🎉 Named Tunnel のセットアップが完了しました！"
  echo "🌐 公開URL: https://${CUSTOM_DOMAIN:-あなたのドメイン}"
  echo "=============================================================================="

elif [ "$CHOICE" = "3" ]; then
  read -p "TUNNEL_TOKEN を入力: " USER_TOKEN
  if [ -n "$USER_TOKEN" ]; then
    echo "TUNNEL_TOKEN=$USER_TOKEN" > .env
  fi
  echo "🐳 Docker Compose でクラウドブラウザと Named Tunnel を同時起動します..."
  docker compose --profile tunnel up -d
  echo "=============================================================================="
  echo "🎉 Docker コンテナとして 24時間バックグラウンド起動しました！"
  echo "=============================================================================="
fi
