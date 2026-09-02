// ==============================================================================
// 無料ホスティング (Render.com 等) の 15分スリープを防止する 24時間死活監視 Ping
// ==============================================================================
const http = require('http');
const https = require('https');

const targetUrl = process.env.PING_TARGET_URL || process.argv[2];

if (!targetUrl) {
  console.log('Usage: node keep-alive.js https://your-app.onrender.com');
  process.exit(1);
}

console.log(`[Keep-Alive] 24時間スリープ防止 Ping を開始します: ${targetUrl}`);

function ping() {
  const client = targetUrl.startsWith('https') ? https : http;
  client.get(targetUrl, (res) => {
    console.log(`[${new Date().toLocaleTimeString()}] Ping 成功: Status ${res.statusCode}`);
  }).on('error', (err) => {
    console.error(`[${new Date().toLocaleTimeString()}] Ping エラー: ${err.message}`);
  });
}

ping();
setInterval(ping, 10 * 60 * 1000);
