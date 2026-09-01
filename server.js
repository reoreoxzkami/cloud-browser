const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const puppeteer = require('puppeteer-core');
const fs = require('fs');

let PORT = parseInt(process.env.PORT, 10) || 3333;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

function getChromeExecutablePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const possiblePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let browser = null;

async function getBrowser() {
  if (browser && browser.connected) return browser;
  const executablePath = getChromeExecutablePath();
  if (!executablePath) {
    console.error('Chrome executable not found.');
    process.exit(1);
  }
  console.log(`Starting ultra-light Chrome instance...`);
  
  // 超省メモリ・超低負荷 Chrome フラグ
  browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--single-process',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--mute-audio',
      '--window-size=1280,720'
    ]
  });

  browser.on('disconnected', () => {
    browser = null;
  });

  return browser;
}

wss.on('connection', async (ws) => {
  console.log('Client connected.');

  let page = null;
  let cdp = null;
  let currentWidth = 1280;
  let currentHeight = 720;
  let currentQuality = 50; // 超軽量・高速転送
  let isScreencasting = false;

  let lastSent = 0;
  const FRAME_INTERVAL = 45; // 最大約22fps (十分滑らかかつCPU負荷最小)

  try {
    const b = await getBrowser();
    page = await b.newPage();
    cdp = await page.createCDPSession();

    await page.setViewport({ width: currentWidth, height: currentHeight, deviceScaleFactor: 1 });

    // Screencastフレーム受信
    cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId });
      } catch (e) {}

      if (ws.readyState !== ws.OPEN) return;

      const now = performance.now();
      // バックプレッシャー: 未送信バッファがある場合は即座に破棄
      if (ws.bufferedAmount > 32768) return;
      if (now - lastSent < FRAME_INTERVAL) return;
      lastSent = now;

      ws.send(JSON.stringify({
        type: 'frame',
        data,
        metadata
      }));
    });

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'navigated',
          url: page.url(),
          title: page.title()
        }));
      }
    });

    const startScreencast = async (quality = currentQuality) => {
      currentQuality = quality;
      if (isScreencasting) {
        try { await cdp.send('Page.stopScreencast'); } catch (e) {}
      }
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: currentQuality,
        maxWidth: currentWidth,
        maxHeight: currentHeight,
        everyNthFrame: 1
      });
      isScreencasting = true;
    };

    await startScreencast();
    
    // 軽量な初期ページ (Google) に移動
    await page.goto('https://www.google.com', { timeout: 10000 }).catch(() => {});

    ws.send(JSON.stringify({
      type: 'navigated',
      url: page.url(),
      title: await page.title().catch(() => 'Google')
    }));

    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message);
        if (!cdp || !page) return;

        switch (msg.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
            break;

          case 'navigate':
            if (msg.url) {
              let targetUrl = msg.url.trim();
              if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
                  targetUrl = 'https://' + targetUrl;
                } else {
                  targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
                }
              }
              page.goto(targetUrl).catch(() => {});
            }
            break;

          case 'reload':
            await cdp.send('Page.reload').catch(() => {});
            break;

          case 'back':
            await page.goBack().catch(() => {});
            break;

          case 'forward':
            await page.goForward().catch(() => {});
            break;

          case 'mouse':
            await cdp.send('Input.dispatchMouseEvent', {
              type: msg.mouseType,
              x: Math.round(msg.x),
              y: Math.round(msg.y),
              button: msg.button || 'none',
              buttons: msg.buttons || 0,
              clickCount: msg.clickCount || 0,
              deltaX: msg.deltaX || 0,
              deltaY: msg.deltaY || 0,
              modifiers: msg.modifiers || 0
            }).catch(() => {});
            break;

          case 'key':
            await cdp.send('Input.dispatchKeyEvent', {
              type: msg.keyType,
              key: msg.key,
              code: msg.code,
              text: msg.text,
              windowsVirtualKeyCode: msg.windowsVirtualKeyCode,
              nativeVirtualKeyCode: msg.nativeVirtualKeyCode,
              modifiers: msg.modifiers || 0
            }).catch(() => {});
            break;

          case 'resize':
            if (msg.width > 200 && msg.height > 200) {
              currentWidth = Math.round(msg.width);
              currentHeight = Math.round(msg.height);
              await page.setViewport({ width: currentWidth, height: currentHeight, deviceScaleFactor: 1 });
              await startScreencast();
            }
            break;

          case 'setQuality':
            if (msg.quality >= 10 && msg.quality <= 100) {
              await startScreencast(msg.quality);
            }
            break;
        }
      } catch (err) {
        console.error('Error in WS message:', err);
      }
    });

    ws.on('close', async () => {
      console.log('Client closed.');
      try {
        if (cdp) await cdp.detach().catch(() => {});
        if (page) await page.close().catch(() => {});
      } catch (e) {}
    });

  } catch (err) {
    console.error('Session init error:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to init browser session' }));
    ws.close();
  }
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`  🚀 Ultra-Light Cloud Browser running on port ${port}`);
    console.log(`  🔗 Open: http://localhost:${port}`);
    console.log(`======================================================\n`);
  });
}

startServer(PORT);
