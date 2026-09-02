#!/bin/bash
# ==============================================================================
# Oracle Cloud / Ubuntu / Debian VPS 完全自動セットアップ＆24時間常時稼働スクリプト
# ==============================================================================
set -e

echo "🚀 [1/4] システムパッケージの更新と Docker のインストール..."
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release git

if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER
fi

echo "🛡️ [2/4] ファイアウォール (ポート 3000) の開放..."
if command -v ufw &> /dev/null; then
  sudo ufw allow 3000/tcp || true
fi
if command -v iptables &> /dev/null; then
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT || true
fi

echo "📦 [3/4] Docker コンテナのビルドと起動..."
docker compose up -d --build

echo "🔄 [4/4] サーバー再起動時の 24時間自動起動 (systemd) の有効化..."
sudo systemctl enable docker

echo "=============================================================================="
echo "🎉 セットアップが完了しました！24時間常時稼働しています。"
echo "🌐 ブラウザからアクセス: http://$(curl -s ifconfig.me):3000"
echo "=============================================================================="
