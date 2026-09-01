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

- `server.js`: ヘッドレス Chrome の起動管理、CDP セッション制御、WebSocket ストリーミングサーバー
- `public/index.html`: ブラウザ UI（アドレスバー、ナビゲーション、画質スライダー、Canvas）
- `public/style.css`: 洗練されたモダン・ダークテーマ UI スタイル
- `public/app.js`: Canvas レンダリング、マウス/キーボード入力イベントの補正・高速送信、Ping 計測
- `Dockerfile`: Debian Slim + Chromium + 日本語フォント構成
- `docker-compose.yml`: コンテナ起動設定 (shm_size 最適化済み)
