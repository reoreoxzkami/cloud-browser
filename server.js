const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const { WebSocketServer } = require('ws');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { spawn, exec } = require('child_process');

let PORT = parseInt(process.env.PORT, 10) || 3000;
const NGROK_DOMAIN = process.env.NGROK_DOMAIN || 'judgingly-prize-chili.ngrok-free.dev';
const app = express();
app.use(express.json());
const server = http.createServer(app);

// クライアント用 WebSocket サーバーと専用バイナリ音声パイプ用 WebSocket サーバー
const wss = new WebSocketServer({ noServer: true });
const audioWss = new WebSocketServer({ noServer: true });

const sessionAudioSenders = new Map(); // sessionId -> Set<ws>

// 低遅延 TCP_NODELAY の有効化
server.on('connection', (socket) => {
  try {
    socket.setNoDelay(true);
  } catch (e) {}
});

// HTTP Upgrade ルーティング
server.on('upgrade', (request, socket, head) => {
  try {
    socket.setNoDelay(true);
    const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
    if (parsedUrl.pathname === '/audio-pipe') {
      audioWss.handleUpgrade(request, socket, head, (ws) => {
        audioWss.emit('connection', ws, request);
      });
    } else {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  } catch (e) {
    socket.destroy();
  }
});

// 専用バイナリ音声パイプライン (無音フレーム完全除去・ゼロオーバーヘッド)
audioWss.on('connection', (ws, req) => {
  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const sessionId = parsedUrl.searchParams.get('session') || 'default';

    ws.on('message', (data, isBinary) => {
      const clients = sessionAudioSenders.get(sessionId);
      if (!clients || clients.size === 0) return;

      const rawBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (rawBuf.length === 0) return;

      // パケットヘッダー 0x02: Audio Chunk (PCM Int16 Stereo 44.1kHz)
      const packet = Buffer.allocUnsafe(1 + rawBuf.length);
      packet[0] = 2;
      rawBuf.copy(packet, 1);

      for (const clientWs of clients) {
        if (clientWs.readyState === clientWs.OPEN && clientWs.bufferedAmount < 65536) {
          clientWs.send(packet, { binary: true });
        }
      }
    });
  } catch (e) {}
});

// 広告・トラッカー遮断リスト (AdBlocker)
const BLOCKED_URL_PATTERNS = [
  '*doubleclick.net*',
  '*googleadservices.com*',
  '*googlesyndication.com*',
  '*adservice.google.*',
  '*youtube.com/api/stats/ads*',
  '*youtube.com/pagead/*',
  '*adnxs.com*',
  '*criteo.com*',
  '*criteo.net*',
  '*scorecardresearch.com*',
  '*amazon-adsystem.com*',
  '*taboola.com*',
  '*outbrain.com*',
  '*popads.net*',
  '*adroll.com*',
  '*rubiconproject.com*',
  '*pubmatic.com*',
  '*openx.net*',
  '*casalemedia.com*',
  '*smartadserver.com*',
  '*advertising.com*',
  '*adcolony.com*',
  '*unityads.unity3d.com*',
  '*applovin.com*',
  '*vungle.com*',
  '*flurry.com*',
  '*chartboost.com*',
  '*admob.com*',
  '*quantserve.com*',
  '*adtech.de*',
  '*adsafeprotected.com*',
  '*moatads.com*',
  '*exponential.com*',
  '*yieldmo.com*',
  '*teads.tv*'
];

// ヘルスチェック用エンドポイント
app.get('/healthz', (req, res) => res.status(200).send('OK'));

// ==============================================================================
// ngrok 24時間停止防止・定期自動オープン＆死活監視マネージャー (Keep-Alive Engine)
// ==============================================================================
class NgrokKeepAliveManager {
  constructor() {
    // デフォルト5分 (Render / Koyeb の15分スリープ制限を確実に回避)
    const envInterval = parseInt(process.env.KEEP_ALIVE_INTERVAL, 10);
    this.intervalMs = (!isNaN(envInterval) && envInterval > 0)
      ? (envInterval < 1000 ? envInterval * 1000 : envInterval)
      : 5 * 60 * 1000;

    // Render やクラウド環境のホスト名を自動検出
    const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME ||
      (process.env.RENDER_EXTERNAL_URL ? new URL(process.env.RENDER_EXTERNAL_URL).hostname : null);
    this.domain = renderHost || NGROK_DOMAIN;
    this.protocol = (this.domain.includes('localhost') || this.domain.includes('127.0.0.1')) ? 'http:' : 'https:';
    this.timer = null;
    this.isRunning = false;
    this.lastPingTime = null;
    this.nextPingTime = null;
    this.stats = {
      totalPings: 0,
      successPings: 0,
      failedPings: 0,
      lastStatusCode: null,
      lastLatencyMs: 0,
      lastError: null,
      lastSuccessTime: null,
      browserVisits: 0,
      history: []
    };
    this.browserVisitEnabled = process.env.KEEP_ALIVE_BROWSER_VISIT === 'true';
  }

  updateHost(host) {
    if (!host) return;
    const cleanHost = host.replace(/^https?:\/\//, '').split('/')[0];
    if (cleanHost && cleanHost !== this.domain) {
      this.domain = cleanHost;
      this.protocol = (cleanHost.includes('localhost') || cleanHost.includes('127.0.0.1')) ? 'http:' : 'https:';
      console.log(`[Keep-Alive] 🔄 監視対象ホストをアクセス元ホストに自動更新: ${this.protocol}//${this.domain}`);
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Keep-Alive] 🛡️ 停止防止自動オープン機能を起動しました (間隔: ${Math.round(this.intervalMs / 1000)}秒)`);
    console.log(`[Keep-Alive] 🎯 監視URL: ${this.protocol}//${this.domain}/healthz`);

    // 起動15秒後に最初の自動オープンを実行（トンネル/サービスの初期確立を待機）
    setTimeout(() => {
      if (this.isRunning) {
        this.ping(false);
      }
    }, 15000);

    this.scheduleNext();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log(`[Keep-Alive] 🛑 ngrok停止防止機能を停止しました。`);
  }

  scheduleNext() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.isRunning) return;
    this.nextPingTime = Date.now() + this.intervalMs;
    this.timer = setTimeout(async () => {
      if (this.isRunning) {
        await this.ping(false);
        this.scheduleNext();
      }
    }, this.intervalMs);
  }

  async ping(isManual = false) {
    const startTime = Date.now();
    this.lastPingTime = startTime;
    this.stats.totalPings++;
    const targetUrl = `${this.protocol || 'https:'}//${this.domain}/healthz`;

    console.log(`[Keep-Alive] [${new Date().toLocaleTimeString()}] 🔄 停止防止定期自動アクセス実行中 (${isManual ? '手動' : '自動'}): ${targetUrl}`);

    try {
      const result = await this.performHttpPing(targetUrl);
      const latency = Date.now() - startTime;
      this.stats.successPings++;
      this.stats.lastStatusCode = result.statusCode;
      this.stats.lastLatencyMs = latency;
      this.stats.lastError = null;
      this.stats.lastSuccessTime = new Date().toISOString();

      this.addHistory({
        time: new Date().toISOString(),
        status: 'success',
        statusCode: result.statusCode,
        latencyMs: latency,
        type: isManual ? 'manual' : 'auto',
        method: 'HTTP'
      });

      console.log(`[Keep-Alive] ✅ アクセス成功! HTTP ${result.statusCode} (${latency}ms) - 停止防止シグナル送信完了`);

      // ヘッドレスブラウザ (Chromium) での完全ページオープンも実行 (DOM構築/スクリプト実行)
      if (this.browserVisitEnabled && browser && browser.connected) {
        this.visitWithBrowser().catch(err => {
          console.log('[Keep-Alive] ブラウザ訪問ログ:', err.message);
        });
      }

      return { success: true, statusCode: result.statusCode, latencyMs: latency };
    } catch (err) {
      const latency = Date.now() - startTime;
      this.stats.failedPings++;
      this.stats.lastStatusCode = 0;
      this.stats.lastLatencyMs = latency;
      this.stats.lastError = err.message;

      this.addHistory({
        time: new Date().toISOString(),
        status: 'error',
        error: err.message,
        latencyMs: latency,
        type: isManual ? 'manual' : 'auto',
        method: 'HTTP'
      });

      console.error(`[Keep-Alive] ⚠️ アクセス失敗 (${err.message}). 対象: ${targetUrl}`);
      // ngrok ドメインかつローカル環境の場合のみトンネル復旧を試行
      if (this.domain.includes('ngrok') && !process.env.RENDER && !process.env.RENDER_EXTERNAL_HOSTNAME) {
        try {
          ensureNgrokTunnel();
        } catch (tunnelErr) {
          console.error('[Keep-Alive] トンネル復旧エラー:', tunnelErr.message);
        }
      }

      return { success: false, error: err.message, latencyMs: latency };
    }
  }

  performHttpPing(urlStr) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlStr);
      const client = parsedUrl.protocol === 'http:' ? http : https;
      const defaultPort = parsedUrl.protocol === 'http:' ? 80 : 443;
      const req = client.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || defaultPort,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'ngrok-skip-browser-warning': '69420',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 CloudBrowser-KeepAlive/2.0',
          'Accept': 'text/html,application/json,*/*',
          'Cache-Control': 'no-cache'
        },
        timeout: 12000
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve({ statusCode: res.statusCode, body });
          } else {
            reject(new Error(`HTTP Status ${res.statusCode}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('Request timed out (12s)'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.end();
    });
  }

  // ヘッドレス Chromium インスタンスで ngrok サイトを実際に開く (完全なアクセスシミュレーション)
  async visitWithBrowser() {
    if (!browser || !browser.connected) return;
    let bgPage = null;
    try {
      console.log(`[Keep-Alive] 🌐 ヘッドレスブラウザで ngrok サイトを開いています: https://${this.domain}`);
      bgPage = await browser.newPage();
      await bgPage.setExtraHTTPHeaders({
        'ngrok-skip-browser-warning': '69420'
      });
      await bgPage.goto(`https://${this.domain}/healthz`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
      this.stats.browserVisits++;
      console.log(`[Keep-Alive] 🌐 ブラウザでのロード完了 (累計訪問回数: ${this.stats.browserVisits}回)`);
    } catch (e) {
      console.log(`[Keep-Alive] ブラウザ訪問ログ:`, e.message);
    } finally {
      if (bgPage) {
        try { await bgPage.close(); } catch (e) {}
      }
    }
  }

  addHistory(entry) {
    this.stats.history.unshift(entry);
    if (this.stats.history.length > 10) {
      this.stats.history.pop();
    }
  }

  getStatus() {
    const now = Date.now();
    const remainingSec = this.nextPingTime ? Math.max(0, Math.round((this.nextPingTime - now) / 1000)) : 0;
    return {
      isRunning: this.isRunning,
      domain: this.domain,
      targetUrl: `https://${this.domain}`,
      intervalMs: this.intervalMs,
      intervalSeconds: Math.round(this.intervalMs / 1000),
      intervalMinutes: +(this.intervalMs / 60000).toFixed(1),
      lastPingTime: this.lastPingTime ? new Date(this.lastPingTime).toISOString() : null,
      nextPingTime: this.nextPingTime ? new Date(this.nextPingTime).toISOString() : null,
      nextPingInSec: remainingSec,
      browserVisitEnabled: this.browserVisitEnabled,
      stats: this.stats
    };
  }

  setConfig({ intervalSeconds, browserVisitEnabled }) {
    if (intervalSeconds && !isNaN(intervalSeconds) && intervalSeconds >= 10) {
      this.intervalMs = intervalSeconds * 1000;
      console.log(`[Keep-Alive] ⚙️ 監視間隔を ${intervalSeconds} 秒に変更しました。`);
      this.scheduleNext();
    }
    if (typeof browserVisitEnabled === 'boolean') {
      this.browserVisitEnabled = browserVisitEnabled;
      console.log(`[Keep-Alive] ⚙️ ブラウザ自動訪問を ${browserVisitEnabled ? '有効' : '無効'} に設定しました。`);
    }
    return this.getStatus();
  }
}

const keepAliveManager = new NgrokKeepAliveManager();

// Keep-Alive ステータス取得 API
app.get('/api/keepalive', (req, res) => {
  if (req.headers.host) {
    keepAliveManager.updateHost(req.headers.host);
  }
  res.json(keepAliveManager.getStatus());
});

// 手動 Keep-Alive トリガー API (今すぐ開いて停止防止)
app.post('/api/keepalive/trigger', async (req, res) => {
  const result = await keepAliveManager.ping(true);
  res.json({
    message: result.success ? 'Keep-Alive ping successful' : 'Keep-Alive ping failed',
    result,
    status: keepAliveManager.getStatus()
  });
});

// Keep-Alive 設定更新 API
app.post('/api/keepalive/config', (req, res) => {
  const { intervalSeconds, browserVisitEnabled } = req.body || {};
  const status = keepAliveManager.setConfig({ intervalSeconds, browserVisitEnabled });
  res.json({ message: 'Keep-Alive configuration updated', status });
});

// Google サジェストプロキシ API
app.get('/api/suggest', (req, res) => {
  const query = req.query.q || '';
  if (!query) return res.json([]);
  const suggestUrl = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
  
  https.get(suggestUrl, (googleRes) => {
    let raw = '';
    googleRes.on('data', chunk => { raw += chunk; });
    googleRes.on('end', () => {
      try {
        const parsed = JSON.parse(raw);
        res.json(parsed[1] || []);
      } catch (e) {
        res.json([]);
      }
    });
  }).on('error', () => {
    res.json([]);
  });
});

// 静的ファイルの配信
app.use(express.static(path.join(__dirname, 'public')));

// SPA ルーティング (404 Not Found 防止)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Chrome / Chromium 実行パスの自動検出
function getChromeExecutablePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const possiblePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let browser = null;
let isLaunching = false;
const launchWaiters = [];

// 高速・安定・60fps 対応 Chrome インスタンスの初期化
async function initBrowser() {
  if (browser && browser.connected) return browser;
  if (isLaunching) {
    return new Promise((resolve, reject) => launchWaiters.push({ resolve, reject }));
  }

  isLaunching = true;
  const executablePath = getChromeExecutablePath();
  if (!executablePath) {
    const err = new Error('Chrome / Chromium executable not found on system.');
    console.error('Error:', err.message);
    isLaunching = false;
    while (launchWaiters.length > 0) {
      launchWaiters.shift().reject(err);
    }
    process.exit(1);
  }

  console.log(`⚡ Starting optimized headless Chrome (60 FPS & Pure Audio) using: ${executablePath}`);

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--no-zygote',
        '--renderer-process-limit=1',
        '--js-flags=--max-old-space-size=256',
        '--autoplay-policy=user-gesture-required',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-extensions',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-default-browser-check',
        '--password-store=basic',
        '--use-mock-keychain',
        '--hide-scrollbars',
        '--window-size=1024,600'
      ]
    });

    browser.on('disconnected', () => {
      console.log('Chromium disconnected.');
      browser = null;
    });

    isLaunching = false;
    while (launchWaiters.length > 0) {
      launchWaiters.shift().resolve(browser);
    }
    return browser;
  } catch (err) {
    isLaunching = false;
    while (launchWaiters.length > 0) {
      launchWaiters.shift().reject(err);
    }
    throw err;
  }
}

// WebSocket 接続処理 (クライアントブラウザ側)
wss.on('connection', (ws) => {
  const sessionId = 'session_' + Math.random().toString(36).slice(2);
  console.log(`Client connected to Cloud Browser session [${sessionId}]`);

  let audioClients = sessionAudioSenders.get(sessionId);
  if (!audioClients) {
    audioClients = new Set();
    sessionAudioSenders.set(sessionId, audioClients);
  }
  audioClients.add(ws);

  let page = null;
  let cdp = null;
  let currentWidth = 854;
  let currentHeight = 480;
  let currentQuality = 25;
  let currentFormat = 'jpeg'; // 'jpeg' or 'webp'
  let currentPreset = 'eco'; // 'eco', 'balanced', 'hd'
  let isScreencasting = false;
  let isBinaryMode = true;
  const pendingMessages = [];
  let isReady = false;
  let isStartingScreencast = false;

  const startScreencast = async (quality = currentQuality, format = currentFormat) => {
    currentQuality = quality;
    currentFormat = format;
    if (!cdp) return;
    if (isStartingScreencast) return;
    isStartingScreencast = true;

    try {
      if (isScreencasting) {
        await cdp.send('Page.stopScreencast').catch(() => {});
        isScreencasting = false;
      }
      await cdp.send('Page.startScreencast', {
        format: currentFormat,
        quality: currentQuality,
        maxWidth: currentWidth,
        maxHeight: currentHeight,
        everyNthFrame: 2
      });
      isScreencasting = true;
    } catch (e) {
      console.error('startScreencast error:', e.message);
    } finally {
      isStartingScreencast = false;
    }
  };

  async function handleBrowserMessage(msg) {
    if (!cdp || !page) return;
    switch (msg.type) {
      case 'navigate':
        if (msg.url) {
          let targetUrl = msg.url.trim();
          if (
            !targetUrl.startsWith('http://') &&
            !targetUrl.startsWith('https://') &&
            !targetUrl.startsWith('data:') &&
            !targetUrl.startsWith('file://') &&
            !targetUrl.startsWith('about:') &&
            !targetUrl.startsWith('chrome://')
          ) {
            if (targetUrl.startsWith('localhost') || targetUrl.startsWith('127.0.0.1')) {
              targetUrl = 'http://' + targetUrl;
            } else if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
              targetUrl = 'https://' + targetUrl;
            } else {
              targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
            }
          }
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'loading', loading: true }));
          }
          page.goto(targetUrl, { timeout: 25000, waitUntil: 'domcontentloaded' }).catch(() => {});
        }
        break;

      case 'reload':
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'loading', loading: true }));
        }
        page.reload({ timeout: 25000, waitUntil: 'domcontentloaded' }).catch(() => {});
        break;

      case 'back':
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'loading', loading: true }));
        }
        page.goBack({ timeout: 25000, waitUntil: 'domcontentloaded' }).catch(() => {});
        break;

      case 'forward':
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'loading', loading: true }));
        }
        page.goForward({ timeout: 25000, waitUntil: 'domcontentloaded' }).catch(() => {});
        break;

      case 'mouse': {
        const mouseType = msg.mouseType;
        const button = msg.button || 'none';
        let buttons = msg.buttons !== undefined ? msg.buttons : 0;
        let clickCount = msg.clickCount || 0;

        if (msg.buttons === undefined) {
          if (mouseType === 'mousePressed') {
            buttons = button === 'right' ? 2 : (button === 'middle' ? 4 : 1);
            if (!clickCount) clickCount = 1;
          } else if (mouseType === 'mouseReleased') {
            buttons = 0;
          } else if (mouseType === 'mouseMoved') {
            buttons = msg.isDragging ? 1 : 0;
          }
        }

        cdp.send('Input.dispatchMouseEvent', {
          type: mouseType,
          x: Math.max(0, Math.round(msg.x || 0)),
          y: Math.max(0, Math.round(msg.y || 0)),
          button,
          buttons,
          clickCount,
          deltaX: Math.round(msg.deltaX || 0),
          deltaY: Math.round(msg.deltaY || 0),
          modifiers: msg.modifiers || 0
        }).catch(() => {});
        break;
      }

      case 'key':
        cdp.send('Input.dispatchKeyEvent', {
          type: msg.keyType || 'keyDown',
          key: msg.key,
          code: msg.code,
          text: msg.text,
          unmodifiedText: msg.unmodifiedText,
          windowsVirtualKeyCode: msg.windowsVirtualKeyCode,
          nativeVirtualKeyCode: msg.nativeVirtualKeyCode,
          modifiers: msg.modifiers || 0
        }).catch(() => {});
        break;

      case 'insertText':
        if (msg.text) {
          cdp.send('Input.insertText', { text: String(msg.text) }).catch(() => {});
        }
        break;

      case 'resize':
        if (msg.width >= 200 && msg.height >= 200) {
          const aspect = (msg.width || 16) / (msg.height || 9);
          
          let MAX_W = 1280;
          let MAX_H = 720;
          if (currentPreset === 'eco') {
            MAX_W = 640;
            MAX_H = 360;
          } else if (currentPreset === 'hd') {
            MAX_W = 1920;
            MAX_H = 1080;
          } else {
            MAX_W = 1024;
            MAX_H = 576;
          }

          let targetWidth = Math.min(MAX_W, Math.max(320, Math.round(msg.width)));
          let targetHeight = Math.round(targetWidth / aspect);
          if (targetHeight > MAX_H) {
            targetHeight = MAX_H;
            targetWidth = Math.round(targetHeight * aspect);
          }
          targetWidth = Math.max(320, targetWidth);
          targetHeight = Math.max(240, targetHeight);

          if (Math.abs(targetWidth - currentWidth) > 16 || Math.abs(targetHeight - currentHeight) > 16) {
            currentWidth = targetWidth;
            currentHeight = targetHeight;
            await page.setViewport({ width: currentWidth, height: currentHeight, deviceScaleFactor: 1 }).catch(() => {});
            await startScreencast();
          }
        }
        break;

      case 'setQuality':
        if (msg.quality >= 10 && msg.quality <= 100) {
          await startScreencast(msg.quality, currentFormat);
        }
        break;

      case 'setPreset':
        if (['eco', 'balanced', 'hd'].includes(msg.preset)) {
          currentPreset = msg.preset;
          if (currentPreset === 'eco') {
            currentQuality = 25;
            currentWidth = 640;
            currentHeight = 360;
          } else if (currentPreset === 'hd') {
            currentQuality = 60;
            currentWidth = 1280;
            currentHeight = 720;
          } else {
            currentQuality = 35;
            currentWidth = 1024;
            currentHeight = 576;
          }
          await page.setViewport({ width: currentWidth, height: currentHeight, deviceScaleFactor: 1 }).catch(() => {});
          await startScreencast(currentQuality, currentFormat);
        }
        break;

      case 'setFormat':
        if (['jpeg', 'webp'].includes(msg.format)) {
          currentFormat = msg.format;
          await startScreencast(currentQuality, currentFormat);
        }
        break;
    }
  }

  ws.on('message', async (message, isBinary) => {
    try {
      if (isBinary) return;

      const msg = JSON.parse(message.toString());

      if (msg.type === 'init') {
        if (msg.binary) {
          isBinaryMode = true;
        }
        if (msg.format && ['jpeg', 'webp'].includes(msg.format)) {
          currentFormat = msg.format;
        }
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
        return;
      }

      if (msg.type === 'toggleAudio') {
        const clients = sessionAudioSenders.get(sessionId);
        if (clients) {
          if (msg.enabled) clients.add(ws);
          else clients.delete(ws);
        }
        return;
      }

      if (!isReady || !cdp || !page) {
        pendingMessages.push(msg);
        return;
      }

      await handleBrowserMessage(msg);
    } catch (err) {
      console.error('Error handling WS message:', err.message);
    }
  });

  ws.on('close', async () => {
    console.log(`Client disconnected from session [${sessionId}]`);
    const clients = sessionAudioSenders.get(sessionId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) sessionAudioSenders.delete(sessionId);
    }
    try {
      if (cdp) await cdp.detach().catch(() => {});
      if (page) await page.close().catch(() => {});
    } catch (e) {}
  });

  // セッション初期化と screencast 開始
  (async () => {
    try {
      const b = await initBrowser();
      page = await b.newPage();
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');

      // ページ内超高速バイナリオーディオパイプラインのインジェクション
      await page.evaluateOnNewDocument(`
        Object.defineProperty(navigator, 'webdriver', { get: () => false });

        (function() {
          const sessId = ${JSON.stringify(sessionId)};
          const port = ${PORT};

          let audioWs = null;
          function connectWs() {
            try {
              audioWs = new WebSocket('ws://localhost:' + port + '/audio-pipe?session=' + sessId);
              audioWs.binaryType = 'arraybuffer';
              audioWs.onclose = () => setTimeout(connectWs, 1000);
              audioWs.onerror = () => {};
            } catch(e) {}
          }
          connectWs();

          function sendPcmAudio(left, right) {
            if (!audioWs || audioWs.readyState !== WebSocket.OPEN) return;
            const len = left.length;

            const i16 = new Int16Array(len * 2);
            let hasSound = false;
            for (let i = 0; i < len; i++) {
              const lVal = Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767)));
              const rVal = Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767)));
              i16[i * 2] = lVal;
              i16[i * 2 + 1] = rVal;
              if (Math.abs(lVal) > 10 || Math.abs(rVal) > 10) {
                hasSound = true;
              }
            }
            // 無音パケットは送信をスキップして帯域を劇的に節約
            if (hasSound) {
              audioWs.send(i16.buffer);
            }
          }

          const OrigAudioCtx = window.AudioContext || window.webkitAudioContext;
          let primaryAudioCtx = null;
          let primaryProcessor = null;

          function getPrimaryAudioContext() {
            if (primaryAudioCtx) return primaryAudioCtx;
            if (!OrigAudioCtx) return null;
            try {
              primaryAudioCtx = new OrigAudioCtx({ sampleRate: 44100 });
              primaryProcessor = primaryAudioCtx.createScriptProcessor(2048, 2, 2);
              primaryProcessor.onaudioprocess = (e) => {
                sendPcmAudio(e.inputBuffer.getChannelData(0), e.inputBuffer.getChannelData(1));
              };
              const gain = primaryAudioCtx.createGain();
              gain.gain.value = 1.0;
              primaryProcessor.connect(gain);
              gain.connect(primaryAudioCtx.destination);
              return primaryAudioCtx;
            } catch(e) {
              return null;
            }
          }

          function hookMediaElement(el) {
            if (el.__cloudAudioHooked) return;
            const ctx = getPrimaryAudioContext();
            if (!ctx) return;
            try {
              el.__cloudAudioHooked = true;
              el.muted = false;
              if (el.volume < 1.0) el.volume = 1.0;

              const source = ctx.createMediaElementSource(el);
              source.connect(primaryProcessor);
              source.connect(ctx.destination);

              if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            } catch(e) {}
          }

          function scanAllMedia() {
            document.querySelectorAll('video, audio').forEach(hookMediaElement);
          }

          function initHooks() {
            scanAllMedia();
            if (document.documentElement) {
              try {
                new MutationObserver(scanAllMedia).observe(document.documentElement, { childList: true, subtree: true });
              } catch(e) {}
            }
          }

          if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', initHooks);
          } else {
            initHooks();
          }
          window.addEventListener('load', initHooks);

          ['play', 'playing', 'timeupdate', 'canplay', 'loadeddata'].forEach(evt => {
            document.addEventListener(evt, (e) => {
              if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
                hookMediaElement(e.target);
                const ctx = getPrimaryAudioContext();
                if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
              }
            }, true);
          });
        })();
      `);

      cdp = await page.createCDPSession();

      // 🛡️ 広告・トラッカーのサーバーサイド遮断 (AdBlocker)
      await cdp.send('Network.enable').catch(() => {});
      await cdp.send('Network.setBlockedURLs', {
        urls: BLOCKED_URL_PATTERNS
      }).catch(() => {});

      // Screencast フレーム配信パイプライン (ゼロコピー・超低遅延 60 FPS 対応)
      cdp.on('Page.screencastFrame', ({ data, sessionId: frameSessionId, metadata }) => {
        cdp.send('Page.screencastFrameAck', { sessionId: frameSessionId }).catch(() => {});

        if (ws.readyState !== ws.OPEN) return;

        // バックプレッシャー制御 (バッファ過多時に即ドロップして遅延蓄積を防止)
        if (ws.bufferedAmount > 32768) {
          return;
        }

        if (isBinaryMode) {
          const byteLen = Buffer.byteLength(data, 'base64');
          const packet = Buffer.allocUnsafe(1 + byteLen);
          packet[0] = 1; // 0x01: Video Frame
          packet.write(data, 1, 'base64');
          ws.send(packet, { binary: true });
        } else {
          ws.send(JSON.stringify({
            type: 'frame',
            data,
            metadata
          }));
        }
      });

      let navDebounce = null;
      const sendNavigated = async () => {
        if (navDebounce) clearTimeout(navDebounce);
        navDebounce = setTimeout(async () => {
          if (ws.readyState === ws.OPEN && page) {
            try {
              const url = page.url() || '';
              const title = (await Promise.race([
                page.title().catch(() => ''),
                new Promise(r => setTimeout(() => r(''), 80))
              ])) || 'Google';

              ws.send(JSON.stringify({
                type: 'navigated',
                url,
                title
              }));
              ws.send(JSON.stringify({
                type: 'loading',
                loading: false
              }));
            } catch (e) {}
          }
        }, 50);
      };

      page.on('framenavigated', async (frame) => {
        if (page && frame === page.mainFrame()) {
          sendNavigated();
        }
      });

      page.on('load', () => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'loading', loading: false }));
        }
        sendNavigated();
      });

      page.on('domcontentloaded', () => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'loading', loading: false }));
        }
        sendNavigated();
        page.addStyleTag({
          content: '*, *::before, *::after { animation-duration: 0.001s !important; transition-duration: 0.001s !important; }'
        }).catch(() => {});
      });

      await page.setViewport({ width: currentWidth, height: currentHeight, deviceScaleFactor: 1 });
      await startScreencast();

      page.goto('https://www.google.com', { timeout: 25000, waitUntil: 'domcontentloaded' }).catch(() => {});
      sendNavigated();

      isReady = true;

      while (pendingMessages.length > 0) {
        const queuedMsg = pendingMessages.shift();
        await handleBrowserMessage(queuedMsg);
      }
    } catch (err) {
      console.error('Session initialization error:', err);
      try {
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to initialize browser session.' }));
        ws.close();
      } catch (e) {}
    }
  })();
});

// ngrok バックグラウンド自動起動マネージャー
function ensureNgrokTunnel() {
  exec(`pgrep -f "ngrok.*${PORT}"`, (err, stdout) => {
    if (stdout && stdout.trim().length > 0) {
      console.log(`🌐 ngrok tunnel already active (PID: ${stdout.trim().split('\n')[0]}). URL: https://${NGROK_DOMAIN}`);
      return;
    }

    console.log(`🚀 Starting ngrok background tunnel for domain: ${NGROK_DOMAIN}...`);
    const ngrokCmd = `ngrok http ${PORT} --url=${NGROK_DOMAIN}`;
    const child = spawn('/bin/sh', ['-c', `${ngrokCmd} > /tmp/ngrok.log 2>&1 &`], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    setTimeout(() => {
      console.log(`🎉 ngrok tunnel successfully launched! Access at: https://${NGROK_DOMAIN}`);
    }, 2000);
  });
}

// サーバー起動と事前ウォームアップ
function startServer(port) {
  server.listen(port, '0.0.0.0', async () => {
    console.log(`\n======================================================`);
    console.log(`  🚀 Ultra-Light Cloud Browser (60 FPS & Pure Audio) running on port ${port}`);
    console.log(`  🔗 Local:  http://0.0.0.0:${port}`);
    console.log(`  🌐 Public: https://${NGROK_DOMAIN}`);
    console.log(`  🛡️ ngrok Keep-Alive: Enabled (Auto-Open & Auto-Healing)`);
    console.log(`======================================================\n`);

    ensureNgrokTunnel();

    // 24時間停止防止・定期自動オープン機能を開始
    keepAliveManager.start();

    try {
      await initBrowser();
      console.log('⚡ Chromium pre-warmed and ready for instant client connections!');
    } catch (e) {
      console.error('Browser pre-warm warning:', e.message);
    }
  });
}

// 終了時のプロセス・リソース解放
async function cleanup() {
  console.log('\nGracefully shutting down server and Chromium instances...');
  keepAliveManager.stop();
  if (browser) {
    try { await browser.close(); } catch (e) {}
    browser = null;
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is busy, trying port ${PORT + 1}...`);
    PORT++;
    startServer(PORT);
  } else {
    console.error('Server error:', e);
  }
});

startServer(PORT);
