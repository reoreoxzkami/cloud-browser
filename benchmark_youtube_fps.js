const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');
ws.binaryType = 'arraybuffer';

let videoFrames = 0;
let lastFrames = 0;
let audioPackets = 0;

ws.on('open', () => {
  console.log('Connected to server, initializing...');
  ws.send(JSON.stringify({ type: 'init', binary: true }));

  setTimeout(() => {
    console.log('Navigating to YouTube video...');
    ws.send(JSON.stringify({ type: 'navigate', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }));

    // Click play if needed
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: 'mouse',
        mouseType: 'mousePressed',
        x: 640,
        y: 400,
        button: 'left',
        clickCount: 1
      }));
      ws.send(JSON.stringify({
        type: 'mouse',
        mouseType: 'mouseReleased',
        x: 640,
        y: 400,
        button: 'left'
      }));
    }, 2000);
  }, 500);
});

ws.on('message', (data, isBinary) => {
  if (isBinary || data instanceof Buffer || data instanceof ArrayBuffer) {
    const buf = Buffer.from(data);
    const packetType = buf[0];
    if (packetType === 1) videoFrames++;
    else if (packetType === 2) audioPackets++;
  }
});

let sec = 0;
let fpsSamples = [];
const interval = setInterval(() => {
  sec++;
  const fps = videoFrames - lastFrames;
  lastFrames = videoFrames;
  console.log(`[Sec ${sec}] Video FPS: ${fps} | Audio packets: ${audioPackets} (Total video: ${videoFrames})`);
  if (sec >= 4) {
    fpsSamples.push(fps);
  }
  if (sec >= 12) {
    clearInterval(interval);
    ws.close();
    const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    console.log(`========================================`);
    console.log(`Average YouTube Video Playback FPS: ${avgFps.toFixed(2)} FPS`);
    console.log(`========================================`);
    process.exit(0);
  }
}, 1000);
