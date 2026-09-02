const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');
ws.binaryType = 'arraybuffer';

let videoFrames = 0;
let lastFrames = 0;

ws.on('open', () => {
  console.log('Connected! Sending init and resize...');
  ws.send(JSON.stringify({ type: 'init', binary: true }));
  ws.send(JSON.stringify({ type: 'resize', width: 960, height: 540 }));
  ws.send(JSON.stringify({ type: 'setQuality', quality: 45 }));

  setTimeout(() => {
    console.log('Navigating to http://localhost:3000/fps_test.html ...');
    ws.send(JSON.stringify({ type: 'navigate', url: 'http://localhost:3000/fps_test.html' }));
  }, 1000);
});

ws.on('message', (data, isBinary) => {
  if (isBinary || data instanceof Buffer || data instanceof ArrayBuffer) {
    const buf = Buffer.from(data);
    if (buf[0] === 1) {
      videoFrames++;
    }
  }
});

let sec = 0;
let fpsSamples = [];
const interval = setInterval(() => {
  sec++;
  const fps = videoFrames - lastFrames;
  lastFrames = videoFrames;
  console.log(`[Sec ${sec}] Received Video FPS: ${fps} (Total frames: ${videoFrames})`);
  if (sec >= 3) {
    fpsSamples.push(fps);
  }
  if (sec >= 10) {
    clearInterval(interval);
    ws.close();
    const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    console.log(`========================================`);
    console.log(`Average Animated FPS: ${avgFps.toFixed(2)} FPS`);
    console.log(`========================================`);
    process.exit(0);
  }
}, 1000);
