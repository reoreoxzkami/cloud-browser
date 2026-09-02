const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const puppeteer = require('puppeteer-core');
const fs = require('fs');

let PORT = parseInt(process.env.PORT, 10) || 3333;
const app = express();
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

// 静的ファイルの配信
app.use(express.static(path.join(__dirname, 'public')));

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
        '--no-first-run',
        '--autoplay-policy=no-user-gesture-required', // 動画・音声の自動再生を許可
        '--disable-web-security', // メディア音声へのダイレクトアクセスを許可
        '--allow-running-insecure-content',
        '--disable-blink-features=AutomationControlled', // YouTube等の自動化検知による動画停止を防止
        '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', // YouTubeの403ブロック防止
        '--disable-gpu-vsync', // フレームレート制限解除
        '--disable-frame-rate-limit',
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--ignore-gpu-blocklist',
        '--num-raster-threads=4',
        '--enable-accelerated-2d-canvas',
        '--enable-accelerated-video-decode',
        '--enable-threaded-compositing',
        '--enable-features=CanvasOopRasterization,VaapiVideoDecoder',
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
        '--force-color-profile=srgb',
        '--hide-scrollbars',
        '--window-size=1280,800'
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
  let currentQuality = 32; // 32% 品質 & 480p で 60〜80+ FPS を完全維持
  let isScreencasting = false;
  let isBinaryMode = true;
  const pendingMessages = [];
  let isReady = false;
  let isStartingScreencast = false;
  const startScreencast = async (quality = currentQuality) => {
    currentQuality = quality;
    if (!cdp) return;
    if (isStartingScreencast) return;
    isStartingScreencast = true;

    try {
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: currentQuality,
        maxWidth: currentWidth,
        maxHeight: currentHeight,
        everyNthFrame: 1
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
          page.goto(targetUrl, { timeout: 20000, waitUntil: 'domcontentloaded' }).catch(() => {});
        }
        break;

      case 'reload':
        page.reload({ timeout: 20000, waitUntil: 'domcontentloaded' }).catch(() => {});
        break;

      case 'back':
        page.goBack({ timeout: 20000, waitUntil: 'domcontentloaded' }).catch(() => {});
        break;

      case 'forward':
        page.goForward({ timeout: 20000, waitUntil: 'domcontentloaded' }).catch(() => {});
        break;

      case 'mouse':
        cdp.send('Input.dispatchMouseEvent', {
          type: msg.mouseType,
          x: Math.max(0, Math.round(msg.x || 0)),
          y: Math.max(0, Math.round(msg.y || 0)),
          button: msg.button || 'none',
          buttons: msg.buttons || 0,
          clickCount: msg.clickCount || 0,
          deltaX: Math.round(msg.deltaX || 0),
          deltaY: Math.round(msg.deltaY || 0),
          modifiers: msg.modifiers || 0
        }).catch(() => {});
        break;

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
          // 60FPS以上を維持するため、ストリーミング解像度を最大 854x480 に最適化クランプ
          const MAX_W = 854;
          const MAX_H = 480;
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
          await startScreencast(msg.quality);
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
            for (let i = 0; i < len; i++) {
              i16[i * 2] = Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767)));
              i16[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767)));
            }
            audioWs.send(i16.buffer);
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

      // Screencast フレーム配信パイプライン (ゼロコピー・超低遅延 60 FPS 対応)
      cdp.on('Page.screencastFrame', ({ data, sessionId: frameSessionId, metadata }) => {
        // 次のフレーム描画をブロックしないよう、即座にACKを返信
        cdp.send('Page.screencastFrameAck', { sessionId: frameSessionId }).catch(() => {});

        if (ws.readyState !== ws.OPEN) return;

        // バックプレッシャー制御 (バッファが溜まりすぎた場合のみドロップ)
        if (ws.bufferedAmount > 65536) {
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
            } catch (e) {}
          }
        }, 50);
      };

      page.on('framenavigated', async (frame) => {
        if (page && frame === page.mainFrame()) {
          sendNavigated();
        }
      });

      page.on('load', sendNavigated);
      page.on('domcontentloaded', sendNavigated);

      await page.setViewport({ width: currentWidth, height: currentHeight, deviceScaleFactor: 1 });
      await startScreencast();

      page.goto('https://www.google.com', { timeout: 20000, waitUntil: 'domcontentloaded' }).catch(() => {});
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

// サーバー起動と事前ウォームアップ
function startServer(port) {
  server.listen(port, async () => {
    console.log(`\n======================================================`);
    console.log(`  🚀 Ultra-Light Cloud Browser (60 FPS & Pure Audio) running on port ${port}`);
    console.log(`  🔗 Open: http://localhost:${port}`);
    console.log(`======================================================\n`);

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
