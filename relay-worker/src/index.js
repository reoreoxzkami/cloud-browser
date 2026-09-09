export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. URL 更新 API (POST /api/update)
    if (url.pathname === '/api/update' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!body || body.token !== env.UPDATE_TOKEN) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (!body.url || !body.url.startsWith('https://')) {
          return new Response(JSON.stringify({ error: 'Invalid URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const now = new Date().toISOString();
        await env.BROWSER_KV.put('tunnel_url', body.url);
        await env.BROWSER_KV.put('updated_at', now);
        await env.BROWSER_KV.put('status', 'online');

        return new Response(JSON.stringify({ success: true, url: body.url, updated_at: now }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 2. ステータス取得 API (GET /api/status)
    if (url.pathname === '/api/status') {
      const tunnelUrl = (await env.BROWSER_KV.get('tunnel_url')) || null;
      const updatedAt = (await env.BROWSER_KV.get('updated_at')) || null;
      const status = (await env.BROWSER_KV.get('status')) || 'offline';
      return new Response(
        JSON.stringify({
          status,
          url: tunnelUrl,
          updated_at: updatedAt,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        }
      );
    }

    // 3. 直接リダイレクト (GET /go)
    if (url.pathname === '/go') {
      const tunnelUrl = await env.BROWSER_KV.get('tunnel_url');
      if (tunnelUrl) {
        return Response.redirect(tunnelUrl, 302);
      }
      return new Response('Cloud Browser is currently offline or starting up.', { status: 503 });
    }

    // 4. メインポータル UI (GET /)
    const currentUrl = await env.BROWSER_KV.get('tunnel_url');
    const updatedAt = await env.BROWSER_KV.get('updated_at');
    const status = (await env.BROWSER_KV.get('status')) || (currentUrl ? 'online' : 'offline');

    let formattedTime = '未接続';
    if (updatedAt) {
      const d = new Date(updatedAt);
      formattedTime = d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + ' (JST)';
    }

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>⚡ Cloud Browser 中継ポータル</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 26, 43, 0.85);
      --border: rgba(255, 255, 255, 0.08);
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --primary-glow: rgba(59, 130, 246, 0.35);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.3);
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(59, 130, 246, 0.15) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(139, 92, 246, 0.12) 0px, transparent 50%);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 36px 32px;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 40px rgba(59, 130, 246, 0.08);
      position: relative;
      overflow: hidden;
    }
    .header {
      text-align: center;
      margin-bottom: 28px;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: linear-gradient(135deg, #1e40af, #3b82f6);
      box-shadow: 0 8px 24px var(--primary-glow);
      font-size: 28px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }
    p.subtitle {
      font-size: 14px;
      color: var(--text-muted);
    }
    .status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 18px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 14px;
      margin-bottom: 24px;
    }
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      font-weight: 600;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      position: relative;
    }
    .status-dot.online {
      background: var(--success);
      box-shadow: 0 0 12px var(--success);
    }
    .status-dot.online::after {
      content: '';
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--success);
      animation: pulse 2s infinite;
    }
    .status-dot.offline {
      background: var(--danger);
      box-shadow: 0 0 8px var(--danger);
    }
    @keyframes pulse {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(2.5); opacity: 0; }
    }
    .time-badge {
      font-size: 12px;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', monospace;
    }
    .url-box {
      margin-bottom: 24px;
    }
    .label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      display: block;
    }
    .url-container {
      display: flex;
      gap: 8px;
    }
    .url-input {
      flex: 1;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--border);
      color: #38bdf8;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      padding: 12px 14px;
      border-radius: 12px;
      outline: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .btn-copy {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0 16px;
      border-radius: 12px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-copy:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .btn-open {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #fff;
      text-decoration: none;
      padding: 16px;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 700;
      box-shadow: 0 8px 24px var(--primary-glow);
      transition: all 0.2s ease;
      cursor: pointer;
      border: none;
    }
    .btn-open:hover {
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      transform: translateY(-1px);
      box-shadow: 0 12px 28px rgba(59, 130, 246, 0.45);
    }
    .btn-open:disabled {
      background: #334155;
      color: #64748b;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    .auto-redirect-box {
      margin-top: 18px;
      text-align: center;
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .btn-cancel {
      background: none;
      border: none;
      color: #ef4444;
      text-decoration: underline;
      cursor: pointer;
      font-size: 12px;
    }
    .progress-bar {
      height: 3px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 2px;
      margin-top: 12px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--primary);
      width: 100%;
      transition: width 0.1s linear;
    }
    .info-footer {
      margin-top: 28px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
    }
    .info-footer strong {
      color: #cbd5e1;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      background: #10b981;
      color: #fff;
      padding: 10px 20px;
      border-radius: 30px;
      font-size: 13px;
      font-weight: 600;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s ease;
      pointer-events: none;
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>

  <div class="card">
    <div class="header">
      <div class="logo-badge">⚡</div>
      <h1>Cloud Browser 接続ポータル</h1>
      <p class="subtitle">Cloudflare Tunnel 24時間常時接続ゲートウェイ</p>
    </div>

    <div class="status-bar">
      <div class="status-indicator">
        <span class="status-dot ${status === 'online' ? 'online' : 'offline'}" id="statusDot"></span>
        <span id="statusText">${status === 'online' ? '稼働中 (Online)' : 'オフライン (待機中)'}</span>
      </div>
      <span class="time-badge" id="timeBadge">${formattedTime}</span>
    </div>

    <div class="url-box">
      <span class="label">現在の Cloudflare Tunnel URL</span>
      <div class="url-container">
        <input type="text" readonly value="${currentUrl || 'トンネル接続を待機しています...'}" id="tunnelUrlInput" class="url-input" />
        <button class="btn-copy" id="copyBtn" onclick="copyUrl()">
          <span>📋</span> コピー
        </button>
      </div>
    </div>

    <a href="${currentUrl || '#'}" id="openBtn" class="btn-open" target="_blank" ${!currentUrl ? 'style="pointer-events:none;opacity:0.6;"' : ''}>
      クラウドブラウザを開く 🚀
    </a>

    ${currentUrl ? `
    <div id="redirectSection">
      <div class="auto-redirect-box">
        <span id="countdownText">⏱️ 3秒後に自動的にブラウザを開きます...</span>
        <button class="btn-cancel" onclick="cancelRedirect()">停止</button>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" id="progressFill"></div>
      </div>
    </div>
    ` : ''}

    <div class="info-footer">
      💡 <strong>固定リダイレクトURL:</strong> このポータルURLに <code>/go</code> をつけると、常に最新のトンネルURLへ即座にリダイレクトされます。<br>
      🔄 トンネルが再接続されて一時URLが変化しても、この中継サイトが自動で最新URLに更新されます。
    </div>
  </div>

  <div class="toast" id="toast">コピーしました！</div>

  <script>
    const currentUrl = ${JSON.stringify(currentUrl)};
    let countdown = 3;
    let totalMs = 3000;
    let elapsedMs = 0;
    let redirectTimer = null;
    let progressTimer = null;
    let isCancelled = false;

    function copyUrl() {
      const input = document.getElementById('tunnelUrlInput');
      if (!input || !input.value || input.value.startsWith('トンネル')) return;
      navigator.clipboard.writeText(input.value).then(() => {
        showToast('URLをコピーしました！');
      });
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function cancelRedirect() {
      isCancelled = true;
      if (redirectTimer) clearInterval(redirectTimer);
      if (progressTimer) clearInterval(progressTimer);
      const sec = document.getElementById('redirectSection');
      if (sec) sec.style.display = 'none';
      showToast('自動転送を停止しました');
    }

    if (currentUrl) {
      progressTimer = setInterval(() => {
        if (isCancelled) return;
        elapsedMs += 50;
        const percent = Math.max(0, 100 - (elapsedMs / totalMs) * 100);
        const fill = document.getElementById('progressFill');
        if (fill) fill.style.width = percent + '%';
        
        const remainingSec = Math.ceil((totalMs - elapsedMs) / 1000);
        const cdText = document.getElementById('countdownText');
        if (cdText && remainingSec >= 0) {
          cdText.innerText = '⏱️ ' + remainingSec + '秒後に自動的にブラウザを開きます...';
        }

        if (elapsedMs >= totalMs) {
          clearInterval(progressTimer);
          window.location.href = currentUrl;
        }
      }, 50);
    }
  </script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  },
};
