// ==============================================================================
// ngrok / 無料ホスティング (Render.com 等) 24時間停止防止・死活監視 Ping スクリプト
// ==============================================================================
const http = require('http');
const https = require('https');

const DEFAULT_NGROK_DOMAIN = process.env.NGROK_DOMAIN || 'judgingly-prize-chili.ngrok-free.dev';
const targetUrl = process.env.PING_TARGET_URL || process.argv[2] || `https://${DEFAULT_NGROK_DOMAIN}/healthz`;
const intervalMinutes = parseInt(process.env.KEEP_ALIVE_MINUTES, 10) || 5; // デフォルト5分 (15分スリープを確実に防止)
const intervalMs = intervalMinutes * 60 * 1000;

console.log('==============================================================================');
console.log('🛡️  ngrok 24時間停止防止・定期自動オープン＆死活監視スクリプト');
console.log(`🌐 監視対象URL:  ${targetUrl}`);
console.log(`⏱️ アクセス間隔:  ${intervalMinutes} 分ごと (${intervalMs / 1000} 秒)`);
console.log('==============================================================================\n');

let pingCount = 0;
let successCount = 0;
let failCount = 0;

function ping() {
  pingCount++;
  const startTime = Date.now();
  const urlObj = new URL(targetUrl);
  const client = urlObj.protocol === 'https:' ? https : http;

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'ngrok-skip-browser-warning': '69420',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 CloudBrowser-KeepAlive/2.0',
      'Accept': 'text/html,application/json,*/*',
      'Cache-Control': 'no-cache'
    },
    timeout: 15000
  };

  const req = client.request(options, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      const latency = Date.now() - startTime;
      if (res.statusCode >= 200 && res.statusCode < 400) {
        successCount++;
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Ping 成功! HTTP ${res.statusCode} (${latency}ms) [累計成功: ${successCount} / 失敗: ${failCount}]`);
      } else {
        failCount++;
        console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ 警告: HTTP ${res.statusCode} (${latency}ms) - トンネルの状態を確認してください。`);
      }
    });
  });

  req.on('timeout', () => {
    req.destroy(new Error('Request timed out (15s)'));
  });

  req.on('error', (err) => {
    failCount++;
    const latency = Date.now() - startTime;
    console.error(`[${new Date().toLocaleTimeString()}] ❌ Ping エラー: ${err.message} (${latency}ms) [累計成功: ${successCount} / 失敗: ${failCount}]`);
  });

  req.end();
}

// 初回実行
ping();

// 定期実行タイマー
setInterval(ping, intervalMs);
