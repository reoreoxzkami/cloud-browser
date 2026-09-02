#!/bin/bash
# ==============================================================================
# Cloudflare Tunnel による 24時間バックグラウンド常時公開スクリプト
# ==============================================================================
set -e

echo "🔍 Cloudflare Tunnel (cloudflared) の起動..."
npx --yes cloudflared tunnel --url http://localhost:3000
