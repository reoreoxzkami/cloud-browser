const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');
ws.binaryType = 'arraybuffer';

let videoFrames = 0;
let lastFrames = 0;

ws.on('open', () => {
  console.log('Connected, navigating to dynamic scrolling page...');
  ws.send(JSON.stringify({ type: 'init', binary: true }));

  // Create an infinite cycling page
  const html = `data:text/html,<html><body style="height:50000px;background:linear-gradient(to bottom, #111, #444, #111, #555, #222);font-size:30px;color:white;"><h1>Infinite Scroll Test</h1>` + 
    Array.from({length: 500}, (_, i) => `<div style="padding:20px;margin:10px;background:rgba(255,255,255,0.1);">Card Item #${i}</div>`).join('') +
    `<script>
      let dir = 1;
      // Also continuously update some element
      const h1 = document.querySelector('h1');
      setInterval(() => {
        h1.textContent = 'Tick ' + Date.now();
      }, 50);
    </script></body></html>`;
    
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'navigate', url: html }));
    
    // Simulate continuous 60Hz scrolling up and down
    let dir = 1;
    let count = 0;
    const scrollInterval = setInterval(() => {
      count++;
      if (count % 100 === 0) dir = -dir;
      ws.send(JSON.stringify({
        type: 'mouse',
        mouseType: 'mouseWheel',
        x: 400,
        y: 300,
        deltaX: 0,
        deltaY: dir * 40,
        modifiers: 0
      }));
    }, 16);
  }, 1000);
});

ws.on('message', (data, isBinary) => {
  if (isBinary || data instanceof Buffer || data instanceof ArrayBuffer) {
    const buf = Buffer.from(data);
    if (buf[0] === 1) videoFrames++;
  }
});

let sec = 0;
let fpsSamples = [];
const interval = setInterval(() => {
  sec++;
  const fps = videoFrames - lastFrames;
  lastFrames = videoFrames;
  console.log(`[Sec ${sec}] Scroll Video FPS: ${fps} (Total frames: ${videoFrames})`);
  if (sec >= 3) {
    fpsSamples.push(fps);
  }
  if (sec >= 10) {
    clearInterval(interval);
    ws.close();
    const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    console.log(`========================================`);
    console.log(`Average Scroll FPS: ${avgFps.toFixed(2)} FPS`);
    console.log(`========================================`);
    process.exit(0);
  }
}, 1000);
