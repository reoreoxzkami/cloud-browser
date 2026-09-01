(() => {
  // DOM 要素
  const canvas = document.getElementById('browser-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
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
  let serverWidth = 1280;
  let serverHeight = 800;
  let isConnected = false;

  // FPS & Ping カウンタ
  let frameCount = 0;
  let lastFpsUpdate = performance.now();
  let currentFps = 0;

  // 画像デコード再利用用
  const renderImg = new Image();
  let isImageLoading = false;
  let pendingFrameData = null;

  renderImg.onload = () => {
    ctx.drawImage(renderImg, 0, 0, canvas.width, canvas.height);
    frameCount++;
    isImageLoading = false;
    if (pendingFrameData) {
      const next = pendingFrameData;
      pendingFrameData = null;
      loadFrame(next);
    }
  };

  function loadFrame(base64Data) {
    if (isImageLoading) {
      pendingFrameData = base64Data;
      return;
    }
    isImageLoading = true;
    renderImg.src = 'data:image/jpeg;base64,' + base64Data;
  }

  // WebSocket 接続初期化
  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    loadingText.textContent = 'クラウドブラウザに接続中...';
    overlay.classList.remove('hidden');

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected to Cloud Browser WebSocket');
      isConnected = true;
      overlay.classList.add('hidden');
      adjustCanvasSize();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'frame':
            loadFrame(msg.data);
            break;

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
            if (rtt < 50) {
              pingText.style.color = '#2ecc71';
            } else if (rtt < 120) {
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
        console.error('Failed to parse WS message:', err);
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

  // キャンバスサイズの調整とサーバー解像度同期
  function adjustCanvasSize() {
    const containerWidth = viewportContainer.clientWidth;
    const containerHeight = viewportContainer.clientHeight;

    if (containerWidth <= 0 || containerHeight <= 0) return;

    // 比率維持またはコンテナ一杯に合わせる
    serverWidth = containerWidth;
    serverHeight = containerHeight;

    canvas.width = serverWidth;
    canvas.height = serverHeight;
    resolutionText.textContent = `${serverWidth} × ${serverHeight}`;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'resize',
        width: serverWidth,
        height: serverHeight
      }));
    }
  }

  let resizeTimeout = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(adjustCanvasSize, 250);
  });

  // 座標変換ヘルパー
  function getCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  // ボタン変換 (0: left, 1: middle, 2: right)
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
    // 30〜60fps程度にthrottleして通信負荷を軽減
    if (now - lastMouseMove < 16) return;
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
    e.preventDefault(); // 右クリックメニューを無効化
  });

  // キーボードイベント
  canvas.addEventListener('keydown', (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // ブラウザ固有のショートカット奪取防止（F5やTabなど）
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
