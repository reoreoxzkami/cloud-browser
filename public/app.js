(() => {
  // DOM 要素
  const canvas = document.getElementById('browser-canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const viewportContainer = document.getElementById('viewport-container');
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');

  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnReload = document.getElementById('btn-reload');
  const urlBar = document.getElementById('url-bar');
  const btnGo = document.getElementById('btn-go');
  const qualitySlider = document.getElementById('quality-slider');
  const qualityLabel = document.getElementById('quality-label');
  const pingText = document.getElementById('ping-text');
  const fpsText = document.getElementById('fps-text');
  const resolutionText = document.getElementById('resolution-text');
  const btnFullscreen = document.getElementById('btn-fullscreen');

  // 内部状態
  let ws = null;
  let isConnected = false;

  // FPS & Ping カウンタ
  let frameCount = 0;
  let lastFpsUpdate = performance.now();
  let currentFps = 0;

  // 高速レンダリング管理 (createImageBitmap + requestAnimationFrame)
  let latestBitmap = null;
  let isRenderPending = false;

  function renderLoop() {
    if (latestBitmap) {
      // 受信した画像の解像度にCanvasの内部バッファを同期
      if (canvas.width !== latestBitmap.width || canvas.height !== latestBitmap.height) {
        canvas.width = latestBitmap.width;
        canvas.height = latestBitmap.height;
        resolutionText.textContent = `${latestBitmap.width} × ${latestBitmap.height}`;
      }
      ctx.drawImage(latestBitmap, 0, 0);
      frameCount++;
    }
    isRenderPending = false;
  }

  function scheduleRender() {
    if (!isRenderPending) {
      isRenderPending = true;
      requestAnimationFrame(renderLoop);
    }
  }

  // WebSocket 接続初期化
  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    loadingText.textContent = '超軽量クラウドブラウザに接続中...';
    overlay.classList.remove('hidden');

    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer'; // ゼロコピー高速バイナリモード

    ws.onopen = () => {
      console.log('Connected to Ultra-Light Cloud Browser (Binary Streaming Mode)');
      isConnected = true;
      overlay.classList.add('hidden');
      sendResize();
    };

    ws.onmessage = async (event) => {
      try {
        // バイナリメッセージ (画像フレーム) の処理
        if (event.data instanceof ArrayBuffer) {
          const buffer = event.data;
          const view = new DataView(buffer);
          const type = view.getUint8(0);

          if (type === 1) { // 0x01 = Frame Image (JPEG)
            const imgData = new Uint8Array(buffer, 1);
            const blob = new Blob([imgData], { type: 'image/jpeg' });
            
            // バックグラウンドスレッドでハードウェア並列デコード
            const bitmap = await createImageBitmap(blob);
            if (latestBitmap) {
              latestBitmap.close(); // 旧Bitmapのメモリを即時解放
            }
            latestBitmap = bitmap;
            scheduleRender();
          }
          return;
        }

        // テキスト/JSON メッセージの処理
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'navigated':
            if (msg.url && document.activeElement !== urlBar) {
              urlBar.value = msg.url;
            }
            if (msg.title) {
              document.title = `${msg.title} - Ultra-Light Cloud Browser`;
            }
            break;

          case 'pong':
            const rtt = Math.round(Date.now() - msg.timestamp);
            pingText.textContent = `${rtt} ms`;
            if (rtt < 40) {
              pingText.style.color = '#2ecc71';
            } else if (rtt < 100) {
              pingText.style.color = '#f39c12';
            } else {
              pingText.style.color = '#e74c3c';
            }
            break;

          case 'error':
            console.error('Server error:', msg.message);
            break;
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected. Reconnecting in 2s...');
      isConnected = false;
      loadingText.textContent = '切断されました。再接続しています...';
      overlay.classList.remove('hidden');
      setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      ws.close();
    };
  }

  // Ping 送信ループ (1秒毎)
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }

    // FPS 計算
    const now = performance.now();
    const elapsed = (now - lastFpsUpdate) / 1000;
    if (elapsed >= 1.0) {
      currentFps = Math.round(frameCount / elapsed);
      fpsText.textContent = `${currentFps} fps`;
      frameCount = 0;
      lastFpsUpdate = now;
    }
  }, 1000);

  // コンテナサイズに合わせてサーバーのViewportを同期
  function sendResize() {
    const width = viewportContainer.clientWidth;
    const height = viewportContainer.clientHeight;

    if (width <= 0 || height <= 0) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'resize',
        width: Math.round(width),
        height: Math.round(height)
      }));
    }
  }

  let resizeTimeout = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(sendResize, 200);
  });

  // 正確なアスペクト比を維持したマウス座標変換
  function getCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY))
    };
  }

  function getButtonName(buttonCode) {
    switch (buttonCode) {
      case 0: return 'left';
      case 1: return 'middle';
      case 2: return 'right';
      default: return 'none';
    }
  }

  function getModifiers(e) {
    let mod = 0;
    if (e.altKey) mod |= 1;
    if (e.ctrlKey) mod |= 2;
    if (e.metaKey) mod |= 4;
    if (e.shiftKey) mod |= 8;
    return mod;
  }

  // マウスイベント
  let lastMouseMove = 0;
  canvas.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastMouseMove < 16) return; // 60fpsに間引き
    lastMouseMove = now;

    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoordinates(e);

    ws.send(JSON.stringify({
      type: 'mouse',
      mouseType: 'mouseMoved',
      x,
      y,
      button: 'none',
      modifiers: getModifiers(e)
    }));
  });

  canvas.addEventListener('mousedown', (e) => {
    canvas.focus();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoordinates(e);

    ws.send(JSON.stringify({
      type: 'mouse',
      mouseType: 'mousePressed',
      x,
      y,
      button: getButtonName(e.button),
      clickCount: e.detail || 1,
      modifiers: getModifiers(e)
    }));
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoordinates(e);

    ws.send(JSON.stringify({
      type: 'mouse',
      mouseType: 'mouseReleased',
      x,
      y,
      button: getButtonName(e.button),
      modifiers: getModifiers(e)
    }));
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoordinates(e);

    ws.send(JSON.stringify({
      type: 'mouse',
      mouseType: 'mouseWheel',
      x,
      y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      modifiers: getModifiers(e)
    }));
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // キーボードイベント
  canvas.addEventListener('keydown', (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (['Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    const isChar = e.key.length === 1;

    ws.send(JSON.stringify({
      type: 'key',
      keyType: isChar ? 'char' : 'rawKeyDown',
      key: e.key,
      code: e.code,
      text: isChar ? e.key : undefined,
      windowsVirtualKeyCode: e.keyCode,
      nativeVirtualKeyCode: e.keyCode,
      modifiers: getModifiers(e)
    }));
  });

  canvas.addEventListener('keyup', (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'key',
      keyType: 'keyUp',
      key: e.key,
      code: e.code,
      windowsVirtualKeyCode: e.keyCode,
      nativeVirtualKeyCode: e.keyCode,
      modifiers: getModifiers(e)
    }));
  });

  // ツールバー操作
  btnBack.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'back' }));
  });

  btnForward.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'forward' }));
  });

  btnReload.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'reload' }));
  });

  function navigateToUrl() {
    const url = urlBar.value.trim();
    if (url && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'navigate', url }));
      canvas.focus();
    }
  }

  btnGo.addEventListener('click', navigateToUrl);
  urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      navigateToUrl();
    }
  });

  // 画質調整スライダー
  qualitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    qualityLabel.textContent = `${val}%`;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'setQuality', quality: val }));
    }
  });

  // 全画面表示
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // 起動
  connect();
})();
