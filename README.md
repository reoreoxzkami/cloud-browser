# 🚀 Ultra-Light Cloud Browser (超軽量クラウドブラウザ)

クラウド・サーバー上で Chromium を起動し、Web ブラウザ（PC・スマホ）からリアルタイムに画面を操作・閲覧できる超軽量リモートブラウザアプリです。

---

## ✨ 主な特徴

- ⚡ **超低遅延・高フレームレート (CDP Screencast + WebSocket)**:
  Chrome DevTools Protocol (CDP) のハードウェア最適化 Screencast を直接ストリーミング。
- 🍃 **クライアント側 超低負荷**:
  HTML5 Canvas 2D + ImageBitmap による高速レンダリング。CPUやバッテリー消費を最小限に抑制。
- 🖱️ **完全な双方向操作同期**:
  クリック、ダブルクリック、右クリック、スムーズスクロール、キーボード入力（ショートカット含む）をミリ秒単位でサーバー側 Chrome に同期。
- 📊 **リアルタイム・モニタリング**:
  Ping (RTT レイテンシ) & FPS のリアルタイム計測表示。
- 🎛️ **動的画質調整スライダー**:
  回線状況に応じて JPEG 画質 (30%〜100%) をリアルタイムに切り替え可能。
- 🛡️ **ngrok 24時間停止防止・定期自動オープン (Keep-Alive Engine)**:
  クラウド無料ホスティング (Render / Koyeb 等) の15分無通信スリープや ngrok 無料トンネルの切断を防止するため、定期的に自動で ngrok サイトを開いてアクセスし、常時稼働を維持。UI上で稼働状況の確認や手動Pingも可能。
- 🐳 **Docker / クラウド完全対応**:
  1 コマンドで Docker コンテナとして立ち上げ可能。日本語フォント同梱で文字化けゼロ。

---

## 🛠️ 起動方法

### 方法 1: ローカル・ホスト環境で直接実行 (推奨)

```bash
cd cloud-browser
npm install
npm start
```

ブラウザで `http://localhost:3000` を開きます。

---

### 方法 2: Docker で実行

```bash
cd cloud-browser
docker compose up -d --build
```

ブラウザで `http://localhost:3000` を開きます。

---

## 📁 プロジェクト構成

- `server.js`: ヘッドレス Chrome の起動管理、CDP セッション制御、WebSocket ストリーミングサーバー、ngrok 24時間停止防止エンジン
- `public/index.html`: ブラウザ UI（アドレスバー、ナビゲーション、画質スライダー、停止防止ステータス、Canvas）
- `public/style.css`: 洗練されたモダン・ダークテーマ UI スタイル
- `public/app.js`: Canvas レンダリング、マウス/キーボード入力イベントの補正、停止防止マネージャーUI制御
- `keep-alive.js`: 独立型 24時間停止防止・定期 Ping スクリプト
- `run-ngrok-24h.sh`: 24時間 ngrok 自動再接続 ＆ バックグラウンド Keep-Alive スクリプト
- `Dockerfile`: Debian Slim + Chromium + 日本語フォント構成
- `docker-compose.yml`: コンテナ起動設定 (shm_size 最適化済み)
- `run-cloudflare-relay.sh`: Cloudflare Tunnel 起動 ＆ 中継ポータル自動更新スクリプト
- `deploy-portal-pages.sh`: Cloudflare Pages 向け中継サイトデプロイスクリプト
- `relay-worker/`: Cloudflare CLI (wrangler) でデプロイされた常時更新中継ポータル Worker

---

## 🌐 外部公開・固定中継ポータル (Cloudflare)

Cloudflare CLI (`wrangler`) を使って中継ポータルをデプロイし、Cloudflare Quick Tunnel の一時URLが変わっても自動で最新URLへ誘導・転送します。

- **中継ポータル固定URL**: `https://cloud-browser-portal.sannon2026.workers.dev`
- **ダイレクト即時リダイレクト**: `https://cloud-browser-portal.sannon2026.workers.dev/go`
- **24時間自動起動サービス**: `cloud-browser-cloudflare.service` (systemd)

