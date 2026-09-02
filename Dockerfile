# 軽量な Node.js Debian Slim ベース
FROM node:20-slim

# Chromium と日本語フォント（文字化け防止）、PulseAudio のインストール
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-noto-cjk \
    pulseaudio \
    pulseaudio-utils \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存パッケージのコピーとインストール
COPY package*.json ./
RUN npm ci --only=production

# アプリケーションコードのコピー
COPY . .

# 環境変数設定
ENV PORT=3000
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]