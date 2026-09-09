(() => {
  const canvas = document.getElementById('browser-canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const viewportContainer = document.getElementById('viewport-container');
  const imeHiddenInput = document.getElementById('ime-hidden-input');
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');
  const progressBar = document.getElementById('progress-bar');

  // 初期キャンバスサイズ
  if (viewportContainer) {
    const initW = viewportContainer.clientWidth || 1024;
    const initH = viewportContainer.clientHeight || 576;
    canvas.width = Math.max(320, Math.round(initW));
    canvas.height = Math.max(240, Math.round(initH));
  }

  // ナビゲーション
  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnReload = document.getElementById('btn-reload');
  const btnHome = document.getElementById('btn-home');
  const urlBar = document.getElementById('url-bar');
  const btnGo = document.getElementById('btn-go');
  const btnPaste = document.getElementById('btn-paste');
  const suggestBox = document.getElementById('suggest-box');

  // 日本語入力
  const imeTextBar = document.getElementById('ime-text-bar');
  const btnImeSend = document.getElementById('btn-ime-send');

  // プリセット & 画質
  const presetButtons = document.querySelectorAll('.preset-btn');
  const qualitySlider = document.getElementById('quality-slider');
  const qualityLabel = document.getElementById('quality-label');

  // 音声
  const btnAudioToggle = document.getElementById('btn-audio-toggle');
  const volumeSlider = document.getElementById('volume-slider');

  // ステータス & その他
  const pingText = document.getElementById('ping-text');
  const fpsText = document.getElementById('fps-text');
  const resolutionText = document.getElementById('resolution-text');
  const formatBadge = document.getElementById('format-badge');
  const btnFullscreen = document.getElementById('btn-fullscreen');

  // 内部状態
  let ws = null;
  let isConnected = false;
  let isComposing = false;
  let currentPreset = 'eco';
  let selectedSuggestIndex = -1;
  let suggestList = [];

  // ----------------------------------------------------
  // プログレスバー制御
  // ----------------------------------------------------
  let progressTimer = null;
  function startProgress() {
    if (!progressBar) return;
    clearInterval(progressTimer);
    progressBar.classList.add('active');
    progressBar.style.width = '15%';
    let current = 15;
    progressTimer = setInterval(() => {
      if (current < 85) {
        current += (85 - current) * 0.15;
        progressBar.style.width = `${Math.round(current)}%`;
      }
    }, 150);
  }

  function finishProgress() {
    if (!progressBar) return;
    clearInterval(progressTimer);
    progressBar.style.width = '100%';
    setTimeout(() => {
      progressBar.classList.remove('active');
      setTimeout(() => {
        progressBar.style.width = '0%';
      }, 300);
    }, 200);
  }

  // ----------------------------------------------------
  // Web Audio リアルタイム PCM 音声再生エンジン
  // ----------------------------------------------------
  let audioCtx = null;
  let audioGainNode = null;
  let isAudioMuted = false;
  let nextAudioTime = 0;
  const SAMPLE_RATE = 44100;
  const CHANNELS = 2;

  function initAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(updateAudioUI).catch(() => {});
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      audioCtx = new AudioContextClass();
      audioGainNode = audioCtx.createGain();
      const vol = (volumeSlider ? parseInt(volumeSlider.value, 10) : 100) / 100;
      audioGainNode.gain.setValueAtTime(isAudioMuted ? 0 : vol, audioCtx.currentTime);
      audioGainNode.connect(audioCtx.destination);
      nextAudioTime = audioCtx.currentTime;
      updateAudioUI();
    } catch (e) {
      console.warn('AudioContext initialization notice:', e);
    }
  }

  function updateAudioUI() {
    if (!btnAudioToggle) return;
    if (isAudioMuted) {
      btnAudioToggle.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
      btnAudioToggle.classList.add('muted');
      btnAudioToggle.title = 'ミュート中（クリックで解除）';
    } else if (audioCtx && audioCtx.state === 'suspended') {
      btnAudioToggle.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
      btnAudioToggle.classList.remove('muted');
      btnAudioToggle.title = '音声一時停止中（クリックで有効化）';
    } else {
      btnAudioToggle.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
      btnAudioToggle.classList.remove('muted');
      btnAudioToggle.title = '音声再生中（クリックでミュート）';
    }
  }

  const JITTER_BUFFER = 0.05; // 50ms ジッターバッファ

  function playPcmRawBuffer(arrayBuffer) {
    if (!audioCtx) {
      initAudio();
      if (!audioCtx) return;
    }

    if (isAudioMuted) return;

    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(updateAudioUI).catch(() => {});
    }

    const byteLen = arrayBuffer.byteLength - 1;
    if (byteLen < 4) return;

    const numSamples = Math.floor(byteLen / 2);
    const numFrames = Math.floor(numSamples / CHANNELS);
    if (numFrames <= 0) return;

    const audioBuffer = audioCtx.createBuffer(CHANNELS, numFrames, SAMPLE_RATE);
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = audioBuffer.getChannelData(1);
    const dataView = new DataView(arrayBuffer, 1);

    for (let i = 0; i < numFrames; i++) {
      leftChannel[i] = dataView.getInt16(i * 4, true) / 32768.0;
      rightChannel[i] = dataView.getInt16(i * 4 + 2, true) / 32768.0;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioGainNode);

    const currentTime = audioCtx.currentTime;
    if (nextAudioTime < currentTime) {
      nextAudioTime = currentTime + JITTER_BUFFER;
    }

    source.start(nextAudioTime);
    nextAudioTime += audioBuffer.duration;

    if (nextAudioTime > currentTime + 0.25) {
      nextAudioTime = currentTime + JITTER_BUFFER;
    }
  }

  function unlockAudio() {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(updateAudioUI).catch(() => {});
    }
  }

  ['click', 'mousedown', 'mouseup', 'keydown', 'touchstart', 'touchend', 'pointerdown'].forEach(ev => {
    window.addEventListener(ev, unlockAudio, { passive: true });
  });

  initAudio();

  // FPS & Ping カウンタ
  let frameCount = 0;
  let lastFpsUpdate = performance.now();
  let currentFps = 0;
  let lastActiveFps = 60;

  // 高速ハードウェアレンダリングエンジン
  let isDecoding = false;
  let pendingBlob = null;

  async function decodeAndRender(blob) {
    if (isDecoding) {
      pendingBlob = blob;
      return;
    }
    isDecoding = true;

    try {
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          resolutionText.textContent = `${bitmap.width} × ${bitmap.height}`;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        frameCount++;
      } else {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            resolutionText.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
          }
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          frameCount++;
        };
        img.src = url;
      }
    } catch (e) {
      try {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            resolutionText.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
          }
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          frameCount++;
        };
        img.src = url;
      } catch (err) {}
    } finally {
      isDecoding = false;
      if (pendingBlob) {
        const next = pendingBlob;
        pendingBlob = null;
        decodeAndRender(next);
      }
    }
  }

  function renderFrame(blob) {
    decodeAndRender(blob);
  }

  // WebSocket 接続管理
  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    loadingText.textContent = '超軽量クラウドブラウザに接続中...';
    overlay.classList.remove('hidden');

    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('Connected to Cloud Browser (Audio + Video Binary Stream)');
      isConnected = true;
      overlay.classList.add('hidden');

      ws.send(JSON.stringify({ type: 'init', binary: true, format: 'jpeg' }));
      adjustCanvasSize();
    };

    ws.onmessage = async (event) => {
      try {
        if (event.data instanceof ArrayBuffer) {
          const view = new Uint8Array(event.data);
          const packetType = view[0];

          if (packetType === 1) {
            // 0x01: ビデオフレーム
            const jpegBytes = new Uint8Array(event.data, 1);
            const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
            renderFrame(blob);
          } else if (packetType === 2) {
            // 0x02: オーディオチャンク
            if (!isAudioMuted) {
              playPcmRawBuffer(event.data);
            }
          }
          return;
        }

        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'frame': {
            if (msg.data) {
              const byteCharacters = atob(msg.data);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: 'image/jpeg' });
              renderFrame(blob);
            }
            break;
          }

          case 'navigated':
            if (msg.url && document.activeElement !== urlBar) {
              urlBar.value = msg.url;
            }
            if (msg.title) {
              document.title = `${msg.title} - Ultra-Light Cloud Browser`;
            }
            finishProgress();
            break;

          case 'loading':
            if (msg.loading) {
              startProgress();
            } else {
              finishProgress();
            }
            break;

          case 'pong': {
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
          }

          case 'error':
            console.error('Server error:', msg.message);
            finishProgress();
            break;
        }
      } catch (err) {
        console.error('Error processing WS message:', err);
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

  // Ping 送信 & FPS 計算
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }

    const now = performance.now();
    const elapsed = (now - lastFpsUpdate) / 1000;
    if (elapsed >= 0.5) {
      currentFps = Math.round(frameCount / elapsed);
      if (currentFps > 0) {
        lastActiveFps = currentFps;
        fpsText.textContent = `${currentFps} fps`;
      } else {
        fpsText.textContent = `${lastActiveFps} fps (Idle)`;
      }
      frameCount = 0;
      lastFpsUpdate = now;
    }
  }, 500);

  // ウィンドウサイズに合わせてブラウザ解像度を同期
  function adjustCanvasSize() {
    const containerWidth = viewportContainer.clientWidth;
    const containerHeight = viewportContainer.clientHeight;

    if (containerWidth < 100 || containerHeight < 100) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'resize',
        width: Math.round(containerWidth),
        height: Math.round(containerHeight)
      }));
    }
  }

  let resizeTimeout = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(adjustCanvasSize, 150);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        adjustCanvasSize();
      }
    }
  });

  // マウス座標計算
  function getCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { x: 0, y: 0 };
    }
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

  // ----------------------------------------------------
  // マウスイベント & IME位置追従
  // ----------------------------------------------------
  let lastMouseMoveTime = 0;
  let lastMouseX = -1;
  let lastMouseY = -1;

  canvas.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastMouseMoveTime < 45) return;
    lastMouseMoveTime = now;

    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoordinates(e);
    const rx = Math.round(x);
    const ry = Math.round(y);

    if (rx === lastMouseX && ry === lastMouseY) return;
    lastMouseX = rx;
    lastMouseY = ry;

    ws.send(JSON.stringify({
      type: 'mouse',
      mouseType: 'mouseMoved',
      x: rx,
      y: ry,
      button: 'none',
      buttons: e.buttons || 0,
      modifiers: getModifiers(e)
    }));
  });

  canvas.addEventListener('mousedown', (e) => {
    unlockAudio();
    hideSuggestBox();

    // 🎯 クリック位置へ不可視IME入力要素を動的追従（ネイティブ変換候補を直下に表示）
    if (imeHiddenInput) {
      imeHiddenInput.style.left = `${e.clientX}px`;
      imeHiddenInput.style.top = `${e.clientY}px`;
      imeHiddenInput.focus({ preventScroll: true });
    } else {
      canvas.focus();
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoordinates(e);

    const btnName = getButtonName(e.button);
    const buttons = e.buttons !== undefined ? e.buttons : (e.button === 2 ? 2 : (e.button === 1 ? 4 : 1));

    ws.send(JSON.stringify({
      type: 'mouse',
      mouseType: 'mousePressed',
      x: Math.round(x),
      y: Math.round(y),
      button: btnName,
      buttons: buttons,
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
      x: Math.round(x),
      y: Math.round(y),
      button: getButtonName(e.button),
      buttons: 0,
      modifiers: getModifiers(e)
    }));
  });

  // スクロール
  let wheelDeltaX = 0;
  let wheelDeltaY = 0;
  let wheelRafId = null;
  let lastWheelX = 0;
  let lastWheelY = 0;

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoordinates(e);
    lastWheelX = Math.round(x);
    lastWheelY = Math.round(y);

    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 24;
      dy *= 24;
    } else if (e.deltaMode === 2) {
      dx *= 300;
      dy *= 300;
    }

    wheelDeltaX += dx;
    wheelDeltaY += dy;

    if (!wheelRafId) {
      wheelRafId = requestAnimationFrame(() => {
        wheelRafId = null;
        if (ws && ws.readyState === WebSocket.OPEN && (wheelDeltaX !== 0 || wheelDeltaY !== 0)) {
          ws.send(JSON.stringify({
            type: 'mouse',
            mouseType: 'mouseWheel',
            x: lastWheelX,
            y: lastWheelY,
            deltaX: Math.round(wheelDeltaX),
            deltaY: Math.round(wheelDeltaY),
            modifiers: getModifiers(e)
          }));
          wheelDeltaX = 0;
          wheelDeltaY = 0;
        }
      });
    }
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // タッチ操作 (スマホ・タブレット)
  let lastTouchX = 0;
  let lastTouchY = 0;
  let isTouchDragging = false;

  canvas.addEventListener('touchstart', (e) => {
    unlockAudio();
    hideSuggestBox();

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      isTouchDragging = false;

      if (imeHiddenInput) {
        imeHiddenInput.style.left = `${touch.clientX}px`;
        imeHiddenInput.style.top = `${touch.clientY}px`;
        imeHiddenInput.focus();
      }

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (touch.clientX - rect.left) * scaleX;
      const y = (touch.clientY - rect.top) * scaleY;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'mouse',
          mouseType: 'mousePressed',
          x: Math.round(x),
          y: Math.round(y),
          button: 'left',
          clickCount: 1,
          modifiers: 0
        }));
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      e.preventDefault();
      const touch = e.touches[0];
      const deltaX = lastTouchX - touch.clientX;
      const deltaY = lastTouchY - touch.clientY;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      isTouchDragging = true;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (touch.clientX - rect.left) * scaleX;
      const y = (touch.clientY - rect.top) * scaleY;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'mouse',
          mouseType: 'mouseWheel',
          x: Math.round(x),
          y: Math.round(y),
          deltaX: Math.round(deltaX * 2),
          deltaY: Math.round(deltaY * 2),
          modifiers: 0
        }));
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (!isTouchDragging && ws && ws.readyState === WebSocket.OPEN) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (lastTouchX - rect.left) * scaleX;
      const y = (lastTouchY - rect.top) * scaleY;

      ws.send(JSON.stringify({
        type: 'mouse',
        mouseType: 'mouseReleased',
        x: Math.round(x),
        y: Math.round(y),
        button: 'left',
        modifiers: 0
      }));
    }
  });

  // ----------------------------------------------------
  // キーボード & 日本語 IME 入力
  // ----------------------------------------------------
  function handleKeydown(e) {
    unlockAudio();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // ショートカットキーの処理
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      urlBar.focus();
      urlBar.select();
      return;
    }

    if (e.isComposing || isComposing) return;

    if (['Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    const isChar = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

    ws.send(JSON.stringify({
      type: 'key',
      keyType: isChar ? 'keyDown' : 'rawKeyDown',
      key: e.key,
      code: e.code,
      text: isChar ? e.key : (e.key === 'Enter' ? '\r' : undefined),
      windowsVirtualKeyCode: e.keyCode,
      nativeVirtualKeyCode: e.keyCode,
      modifiers: getModifiers(e)
    }));
  }

  function handleKeyup(e) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (e.isComposing || isComposing) return;

    ws.send(JSON.stringify({
      type: 'key',
      keyType: 'keyUp',
      key: e.key,
      code: e.code,
      windowsVirtualKeyCode: e.keyCode,
      nativeVirtualKeyCode: e.keyCode,
      modifiers: getModifiers(e)
    }));
  }

  canvas.addEventListener('keydown', handleKeydown);
  canvas.addEventListener('keyup', handleKeyup);

  const handlePaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData)?.getData('text');
    if (text && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'insertText',
        text: text
      }));
    }
  };
  canvas.addEventListener('paste', handlePaste);

  // 不可視 IME 入力レイヤー
  if (imeHiddenInput) {
    imeHiddenInput.addEventListener('compositionstart', () => {
      isComposing = true;
    });

    imeHiddenInput.addEventListener('compositionend', (e) => {
      isComposing = false;
      const text = e.data || imeHiddenInput.value;
      if (text && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'insertText',
          text: text
        }));
      }
      imeHiddenInput.value = '';
    });

    imeHiddenInput.addEventListener('input', (e) => {
      if (!isComposing && e.inputType && !['insertText', 'deleteContentBackward'].includes(e.inputType)) {
        const text = imeHiddenInput.value;
        if (text && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'insertText',
            text: text
          }));
        }
      }
      if (!isComposing) {
        imeHiddenInput.value = '';
      }
    });

    imeHiddenInput.addEventListener('keydown', handleKeydown);
    imeHiddenInput.addEventListener('keyup', handleKeyup);
    imeHiddenInput.addEventListener('paste', handlePaste);
  }

  // ツールバーのかな送信
  function sendJapaneseToolbarText() {
    const text = imeTextBar.value;
    if (text && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'insertText',
        text: text
      }));
      imeTextBar.value = '';
      if (imeHiddenInput) imeHiddenInput.focus();
    }
  }

  btnImeSend.addEventListener('click', sendJapaneseToolbarText);
  imeTextBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      sendJapaneseToolbarText();
    }
  });

  // クリップボード貼り付けボタン
  if (btnPaste) {
    btnPaste.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'insertText',
            text: text
          }));
          if (imeHiddenInput) imeHiddenInput.focus();
        }
      } catch (err) {
        console.warn('Clipboard read error:', err);
      }
    });
  }

  // 音声ミュート / 解除ボタン
  if (btnAudioToggle) {
    btnAudioToggle.addEventListener('click', () => {
      unlockAudio();
      isAudioMuted = !isAudioMuted;
      if (audioGainNode && audioCtx) {
        const vol = (volumeSlider ? parseInt(volumeSlider.value, 10) : 100) / 100;
        audioGainNode.gain.setValueAtTime(isAudioMuted ? 0 : vol, audioCtx.currentTime);
      }
      updateAudioUI();
    });
  }

  // 音量スライダー
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      unlockAudio();
      const val = parseInt(e.target.value, 10);
      const vol = val / 100;
      isAudioMuted = (val === 0);
      if (audioGainNode && audioCtx) {
        audioGainNode.gain.setValueAtTime(isAudioMuted ? 0 : vol, audioCtx.currentTime);
      }
      updateAudioUI();
    });
  }

  // ----------------------------------------------------
  // ナビゲーション & Google サジェスト
  // ----------------------------------------------------
  btnBack.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      startProgress();
      ws.send(JSON.stringify({ type: 'back' }));
    }
  });

  btnForward.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      startProgress();
      ws.send(JSON.stringify({ type: 'forward' }));
    }
  });

  btnReload.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      startProgress();
      ws.send(JSON.stringify({ type: 'reload' }));
    }
  });

  if (btnHome) {
    btnHome.addEventListener('click', () => {
      navigateToUrl('https://www.google.com');
    });
  }

  function navigateToUrl(targetUrl) {
    const url = (targetUrl || urlBar.value).trim();
    if (url && ws && ws.readyState === WebSocket.OPEN) {
      startProgress();
      hideSuggestBox();
      ws.send(JSON.stringify({ type: 'navigate', url }));
      if (imeHiddenInput) imeHiddenInput.focus();
    }
  }

  btnGo.addEventListener('click', () => navigateToUrl());

  // クイックアクセスリンク
  document.querySelectorAll('.quick-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const url = btn.getAttribute('data-url');
      if (url) {
        urlBar.value = url;
        navigateToUrl(url);
      }
    });
  });

  // Google サジェスト取得 & ドロップダウン表示
  let suggestTimeout = null;

  function hideSuggestBox() {
    if (suggestBox) {
      suggestBox.classList.add('hidden');
      suggestBox.innerHTML = '';
      selectedSuggestIndex = -1;
    }
  }

  function renderSuggestList(items) {
    if (!suggestBox) return;
    suggestList = items;
    selectedSuggestIndex = -1;

    if (!items || items.length === 0) {
      hideSuggestBox();
      return;
    }

    suggestBox.innerHTML = '';
    items.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'suggest-item';
      div.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> <span>${item}</span>`;
      div.addEventListener('click', () => {
        urlBar.value = item;
        navigateToUrl(item);
      });
      suggestBox.appendChild(div);
    });

    suggestBox.classList.remove('hidden');
  }

  urlBar.addEventListener('input', () => {
    clearTimeout(suggestTimeout);
    const query = urlBar.value.trim();
    if (!query || query.startsWith('http://') || query.startsWith('https://')) {
      hideSuggestBox();
      return;
    }

    suggestTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        renderSuggestList(data);
      } catch (e) {
        hideSuggestBox();
      }
    }, 150);
  });

  urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (selectedSuggestIndex >= 0 && suggestList[selectedSuggestIndex]) {
        urlBar.value = suggestList[selectedSuggestIndex];
      }
      navigateToUrl();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestList.length > 0) {
        selectedSuggestIndex = (selectedSuggestIndex + 1) % suggestList.length;
        updateSuggestSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestList.length > 0) {
        selectedSuggestIndex = (selectedSuggestIndex - 1 + suggestList.length) % suggestList.length;
        updateSuggestSelection();
      }
    } else if (e.key === 'Escape') {
      hideSuggestBox();
    }
  });

  function updateSuggestSelection() {
    const items = suggestBox.querySelectorAll('.suggest-item');
    items.forEach((it, idx) => {
      if (idx === selectedSuggestIndex) {
        it.classList.add('selected');
        urlBar.value = suggestList[idx];
      } else {
        it.classList.remove('selected');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!urlBar.contains(e.target) && !suggestBox.contains(e.target)) {
      hideSuggestBox();
    }
  });

  // ----------------------------------------------------
  // 解像度プリセット & 画質コントロール
  // ----------------------------------------------------
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPreset = preset;

      if (preset === 'eco') {
        qualitySlider.value = 25;
        qualityLabel.textContent = '25%';
      } else if (preset === 'hd') {
        qualitySlider.value = 60;
        qualityLabel.textContent = '60%';
      } else {
        qualitySlider.value = 35;
        qualityLabel.textContent = '35%';
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'setPreset', preset }));
      }
    });
  });

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

  // ----------------------------------------------------
  // ngrok 24時間停止防止・Keep-Alive フロントエンド管理
  // ----------------------------------------------------
  const btnKeepaliveModal = document.getElementById('btn-keepalive-modal');
  const keepaliveStatusText = document.getElementById('keepalive-status-text');
  const keepaliveModal = document.getElementById('keepalive-modal');
  const keepaliveModalBackdrop = document.getElementById('keepalive-modal-backdrop');
  const btnCloseKeepaliveModal = document.getElementById('btn-close-keepalive-modal');

  const modalKeepaliveStatus = document.getElementById('modal-keepalive-status');
  const modalKeepaliveUrl = document.getElementById('modal-keepalive-url');
  const modalKeepaliveInterval = document.getElementById('modal-keepalive-interval');
  const modalKeepaliveCountdown = document.getElementById('modal-keepalive-countdown');
  const modalKeepaliveStats = document.getElementById('modal-keepalive-stats');
  const modalKeepaliveBrowser = document.getElementById('modal-keepalive-browser');
  const btnTriggerKeepalive = document.getElementById('btn-trigger-keepalive');
  const btnOpenNgrokTab = document.getElementById('btn-open-ngrok-tab');
  const keepaliveLogList = document.getElementById('keepalive-log-list');

  let currentKeepaliveData = null;
  let nextPingRemainingSec = 0;
  let countdownTimer = null;

  async function fetchKeepaliveStatus() {
    try {
      const res = await fetch('/api/keepalive');
      if (!res.ok) return;
      const data = await res.json();
      currentKeepaliveData = data;
      updateKeepaliveUI(data);
    } catch (e) {
      // ネットワーク切断中など
    }
  }

  function updateKeepaliveUI(data) {
    if (!data) return;

    // ツールバーバッジ更新
    if (keepaliveStatusText && btnKeepaliveModal) {
      if (data.stats && data.stats.lastError && data.stats.failedPings > 0 && data.stats.lastStatusCode === 0) {
        btnKeepaliveModal.classList.add('error');
        keepaliveStatusText.textContent = `停止防止: 要確認 (${data.stats.lastError})`;
      } else {
        btnKeepaliveModal.classList.remove('error');
        const intervalM = data.intervalMinutes || 5;
        const total = data.stats ? data.stats.successPings : 0;
        keepaliveStatusText.textContent = `停止防止: 稼働中 (${intervalM}分間隔 / 成功 ${total}回)`;
      }
    }

    // モーダル更新
    if (modalKeepaliveStatus) {
      const isErr = data.stats && data.stats.lastError && data.stats.failedPings > 0 && data.stats.lastStatusCode === 0;
      modalKeepaliveStatus.innerHTML = isErr
        ? `<span style="color: #ef4444;">⚠️ 警告: ${escapeHtml(data.stats.lastError)} (自動再接続中)</span>`
        : `<span style="color: #10b981;">🟢 24時間常時稼働中 (自動オープン稼働)</span>`;
    }

    if (modalKeepaliveUrl) {
      modalKeepaliveUrl.textContent = data.targetUrl || `https://${data.domain}`;
      modalKeepaliveUrl.href = data.targetUrl || `https://${data.domain}`;
    }

    if (btnOpenNgrokTab) {
      btnOpenNgrokTab.href = data.targetUrl || `https://${data.domain}`;
    }

    if (modalKeepaliveInterval) {
      modalKeepaliveInterval.textContent = `${data.intervalMinutes}分ごと (${data.intervalSeconds}秒)`;
    }

    if (modalKeepaliveStats && data.stats) {
      const lat = data.stats.lastLatencyMs ? `${data.stats.lastLatencyMs}ms` : '--';
      modalKeepaliveStats.textContent = `成功: ${data.stats.successPings}回 / 失敗: ${data.stats.failedPings}回 (最新遅延: ${lat})`;
    }

    if (modalKeepaliveBrowser) {
      modalKeepaliveBrowser.textContent = data.browserVisitEnabled
        ? `有効 (Chromium完全描画 / 累計訪問 ${data.stats ? data.stats.browserVisits : 0}回)`
        : `無効 (超軽量HTTP Pingモード)`;
    }

    // カウントダウン更新
    nextPingRemainingSec = data.nextPingInSec || 0;
    renderCountdown();

    // ログリスト更新
    if (keepaliveLogList && data.stats && data.stats.history) {
      if (data.stats.history.length === 0) {
        keepaliveLogList.innerHTML = '<div class="log-empty">最初の自動オープンを待機中 (起動15秒後に実行)...</div>';
      } else {
        keepaliveLogList.innerHTML = data.stats.history.map(item => {
          const timeStr = item.time ? new Date(item.time).toLocaleTimeString() : '';
          const isSuccess = item.status === 'success';
          const badgeClass = isSuccess ? 'success' : 'error';
          const detail = isSuccess
            ? `HTTP ${item.statusCode} (${item.latencyMs}ms) [${item.type || 'auto'}]`
            : `エラー: ${item.error || '通信遮断'} (${item.latencyMs}ms)`;
          return `<div class="log-item ${badgeClass}"><span>[${timeStr}] ${detail}</span><span>${isSuccess ? '✅' : '⚠️'}</span></div>`;
        }).join('');
      }
    }
  }

  function renderCountdown() {
    if (!modalKeepaliveCountdown) return;
    if (nextPingRemainingSec <= 0) {
      modalKeepaliveCountdown.textContent = 'アクセス実行中...';
    } else {
      const m = Math.floor(nextPingRemainingSec / 60);
      const s = nextPingRemainingSec % 60;
      modalKeepaliveCountdown.textContent = m > 0 ? `${m}分 ${s}秒後` : `${s}秒後`;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 1秒ごとのカウントダウン減算
  countdownTimer = setInterval(() => {
    if (nextPingRemainingSec > 0) {
      nextPingRemainingSec--;
      renderCountdown();
    }
  }, 1000);

  // モーダルイベント
  if (btnKeepaliveModal) {
    btnKeepaliveModal.addEventListener('click', () => {
      fetchKeepaliveStatus();
      if (keepaliveModal) keepaliveModal.classList.remove('hidden');
    });
  }

  function closeKeepaliveModal() {
    if (keepaliveModal) keepaliveModal.classList.add('hidden');
  }

  if (btnCloseKeepaliveModal) {
    btnCloseKeepaliveModal.addEventListener('click', closeKeepaliveModal);
  }
  if (keepaliveModalBackdrop) {
    keepaliveModalBackdrop.addEventListener('click', closeKeepaliveModal);
  }

  // 手動今すぐアクセスボタン
  if (btnTriggerKeepalive) {
    btnTriggerKeepalive.addEventListener('click', async () => {
      btnTriggerKeepalive.disabled = true;
      btnTriggerKeepalive.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ngrok サイトにアクセス中...';
      try {
        const res = await fetch('/api/keepalive/trigger', { method: 'POST' });
        const data = await res.json();
        if (data.status) {
          currentKeepaliveData = data.status;
          updateKeepaliveUI(data.status);
        }
      } catch (err) {
        console.error('Trigger keepalive error:', err);
      } finally {
        btnTriggerKeepalive.disabled = false;
        btnTriggerKeepalive.innerHTML = '<i class="fa-solid fa-rotate"></i> 今すぐ ngrok サイトを開いてPing';
      }
    });
  }

  // 定期ステータスポーリング (12秒ごと)
  setInterval(fetchKeepaliveStatus, 12000);
  fetchKeepaliveStatus();

  // 起動
  connect();
})();
