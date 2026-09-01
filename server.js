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
    console.error('Error: Chrome executable not found.');
    process.exit(1);
  }
  console.log(`Starting ultra-fast Chrome using: ${executablePath}`);
  
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
      '--window-size=1280,800'
    ]
  });

  browser.on('disconnected', () => {
    browser = null;
  });

  return browser;
}

wss.on('connection', async (ws) => {
  console.log('Client connected to session');

  let page = null;
  let cdp = null;
  let currentWidth = 1280;
  let currentHeight = 800;
  let currentQuality = 80;
  let isScreencasting = false;

  try {
    const b = await getBrowser();
    page = await b.newPage();
    cdp = await page.createCDPSession();

    await page.setViewport({ width: currentWidth, height: currentHeight, deviceScaleFactor: 1 });

    // 初期バージョンの最速即時Screencast
    cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId });
      } catch (e) {}

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'frame',
          data,
          metadata
        }));
      }
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
    page.goto('https://www.google.com').catch(() => {});

    ws.send(JSON.stringify({
      type: 'navigated',
      url: 'https://www.google.com',
      title: 'Google'
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
            page.reload().catch(() => {});
            break;

          case 'back':
            page.goBack().catch(() => {});
            break;

          case 'forward':
            page.goForward().catch(() => {});
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

          case 'insertText':
            // ★ 日本語テキスト（漢字・ひらがな等）の直接挿入
            if (msg.text) {
              await cdp.send('Input.insertText', { text: msg.text }).catch(() => {});
            }
            break;

          case 'resize':
            if (msg.width > 100 && msg.height > 100) {
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
      console.log('Client closed session.');
      try {
        if (cdp) await cdp.detach().catch(() => {});
        if (page) await page.close().catch(() => {});
      } catch (e) {}
    });

  } catch (err) {
    console.error('Session error:', err);
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
