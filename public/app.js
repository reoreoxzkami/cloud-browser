(() => {
  const canvas = document.getElementById('browser-canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const viewportContainer = document.getElementById('viewport-container');
  const imeHiddenInput = document.getElementById('ime-hidden-input');
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');

  // 初期キャンバスサイズの適用
  if (viewportContainer) {
    const initW = viewportContainer.clientWidth || 1024;
    const initH = viewportContainer.clientHeight || 576;
    canvas.width = Math.max(320, Math.round(initW));
    canvas.height = Math.max(240, Math.round(initH));
  }

  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnReload = document.getElementById('btn-reload');
  const urlBar = document.getElementById('url-bar');
  const btnGo = document.getElementById('btn-go');

  // 日本語・かな入力バー
  const imeTextBar = document.getElementById('ime-text-bar');
  const btnImeSend = document.getElementById('btn-ime-send');

  // 音声コントロール
  const btnAudioToggle = document.getElementById('btn-audio-toggle');
  const volumeSlider = document.getElementById('volume-slider');

  const qualitySlider = document.getElementById('quality-slider');
  const qualityLabel = document.getElementById('quality-label');
  const pingText = document.getElementById('ping-text');
  const fpsText = document.getElementById('fps-text');
  const resolutionText = document.getElementById('resolution-text');
  const btnFullscreen = document.getElementById('btn-fullscreen');

  // 内部状態
  let ws = null;
  let isConnected = false;
  let isComposing = false; // 日本語IME変換中フラグ

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
      // 端末のネイティブサンプリングレートで AudioContext を作成
      audioCtx = new AudioContextClass();
      audioGainNode = audioCtx.createGain();
      const vol = (volumeSlider ? parseInt(volumeSlider.value, 10) : 100) / 100;
      audioGainNode.gain.setValueAtTime(isAudioMuted ? 0 : vol, audioCtx.currentTime);
      audioGainNode.connect(audioCtx.destination);
      nextAudioTime = audioCtx.currentTime;
      console.log(`🔊 Web Audio PCM Engine initialized (Hardware: ${audioCtx.sampleRate}Hz, Stream: ${SAMPLE_RATE}Hz)`);
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

  const JITTER_BUFFER = 0.05; // 50ms の滑らかで音切れしないジッターバッファ

  function playPcmRawBuffer(arrayBuffer) {
    if (!audioCtx) {
      initAudio();
      if (!audioCtx) return;
    }

    if (isAudioMuted) {
      return;
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(updateAudioUI).catch(() => {});
    }

    const byteLen = arrayBuffer.byteLength - 1;
    if (byteLen < 4) return;

    const numSamples = Math.floor(byteLen / 2);
    const numFrames = Math.floor(numSamples / CHANNELS);
    if (numFrames <= 0) return;

    // Web Audio API は 44.1kHz のバッファをハードウェアレート (48kHz等) に自動リサンプリング
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

    // 音切れ防止: 再生予定時刻が遅れている場合は 50ms 先に滑らかにスケジュール
    if (nextAudioTime < currentTime) {
      nextAudioTime = currentTime + JITTER_BUFFER;
    }

    source.start(nextAudioTime);
    nextAudioTime += audioBuffer.duration;

    // ドリフト制御: バッファが過剰に蓄積した場合 (> 250ms) のみスムーズに同期
    if (nextAudioTime > currentTime + 0.25) {
      nextAudioTime = currentTime + JITTER_BUFFER;
    }
  }

  // あらゆるユーザー操作で AudioContext を即座にアンロック
  function unlockAudio() {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(updateAudioUI).catch(() => {});
    }
  }

  ['click', 'mousedown', 'mouseup', 'keydown', 'touchstart', 'touchend', 'pointerdown'].forEach(ev => {
    window.addEventListener(ev, unlockAudio, { passive: true });
  });

  // 初期化試行
  initAudio();

  // FPS & Ping カウンタ
  let frameCount = 0;
  let lastFpsUpdate = performance.now();
  let currentFps = 0;

  // 高速かつ超安定・60fps ハードウェア並列デコード＆レンダリングエンジン
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
    ws.binaryType = 'arraybuffer'; // 高速バイナリ通信を有効化

    ws.onopen = () => {
      console.log('Connected to Cloud Browser (Audio + Video Binary Stream)');
      isConnected = true;
      overlay.classList.add('hidden');

      // サーバーにバイナリ最適化モードを通知
      ws.send(JSON.stringify({ type: 'init', binary: true }));
      adjustCanvasSize();
    };

    ws.onmessage = async (event) => {
      try {
        // バイナリパケット受信
        if (event.data instanceof ArrayBuffer) {
          const view = new Uint8Array(event.data);
          const packetType = view[0];

          if (packetType === 1) {
            // 0x01: ビデオフレーム (JPEG)
            const jpegBytes = new Uint8Array(event.data, 1);
            const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
            renderFrame(blob);
          } else if (packetType === 2) {
            // 0x02: オーディオチャンク (PCM Int16 Stereo 44.1kHz)
            if (!isAudioMuted) {
              playPcmRawBuffer(event.data);
            }
          }
          return;
        }

        // テキスト/JSON メッセージ受信
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'frame': {
            // JSON 互換モードのフォールバック
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

  // Ping 送信 & FPS 計算 (0.5秒ごとにレスポンシブ更新)
  let lastActiveFps = 60;
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

  // タブ再フォーカス時の復帰
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

  // マウス座標計算 (比率補正 & ゼロ除算ガード)
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

  // マウスイベント (無駄なイベント送信の間引き・軽量化)
  let lastMouseMoveTime = 0;
  let lastMouseX = -1;
  let lastMouseY = -1;

  canvas.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastMouseMoveTime < 24) return; // 40Hz でマウス送信 (Blink の負荷を大幅削減)
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
      modifiers: getModifiers(e)
    }));
  });

  canvas.addEventListener('mousedown', (e) => {
    unlockAudio();
    if (imeHiddenInput) {
      imeHiddenInput.focus();
    } else {
      canvas.focus();
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { x, y } = getCoordinates(e);

    ws.send(JSON.stringify({
      type: 'mouse',
      mouseType: 'mousePressed',
      x: Math.round(x),
      y: Math.round(y),
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
      x: Math.round(x),
      y: Math.round(y),
      button: getButtonName(e.button),
      modifiers: getModifiers(e)
    }));
  });

  // スクロール (rAFフレーム集約による超滑らかな 60FPS スクロール)
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

  // タッチ操作サポート (スマホ・タブレット対応)
  let lastTouchX = 0;
  let lastTouchY = 0;
  let isTouchDragging = false;

  canvas.addEventListener('touchstart', (e) => {
    unlockAudio();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      isTouchDragging = false;

      if (imeHiddenInput) imeHiddenInput.focus();

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
  // キーボード & 日本語 IME 入力処理 (二重入力防止設計)
  // ----------------------------------------------------

  function handleKeydown(e) {
    unlockAudio();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // IME変換中はキーイベントを直接送らない (確定時に insertText を送信)
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

  // クリップボード貼り付けハンドラ
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

  // 不可視 IME 入力レイヤーによる Canvas 上の日本語直接入力
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
      // keydown 以外の入力（音声入力・予測変換確定など）のみ処理し二重入力を完全防止
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

  // ツールバーの明示的日本語・かな送信
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
      if (val === 0) {
        isAudioMuted = true;
      } else {
        isAudioMuted = false;
      }
      if (audioGainNode && audioCtx) {
        audioGainNode.gain.setValueAtTime(isAudioMuted ? 0 : vol, audioCtx.currentTime);
      }
      updateAudioUI();
    });
  }

  // ツールバーナビゲーション
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
      if (imeHiddenInput) imeHiddenInput.focus();
    }
  }

  btnGo.addEventListener('click', navigateToUrl);
  urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      navigateToUrl();
    }
  });

  // 画質スライダー調整
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
