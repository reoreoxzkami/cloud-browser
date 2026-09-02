const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');
ws.binaryType = 'arraybuffer';

let videoFrames = 0;
let audioPackets = 0;
let totalAudioBytes = 0;

ws.on('open', () => {
  console.log('WS connected. Initializing binary audio/video session...');
  ws.send(JSON.stringify({ type: 'init', binary: true }));

  setTimeout(() => {
    console.log('Navigating to YouTube video (https://www.youtube.com/watch?v=dQw4w9WgXcQ)...');
    ws.send(JSON.stringify({ type: 'navigate', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }));

    // Send click to trigger video playback on YouTube
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
    }, 1500);
  }, 500);
});

ws.on('message', (data, isBinary) => {
  if (isBinary || data instanceof Buffer || data instanceof ArrayBuffer) {
    const buf = Buffer.from(data);
    const packetType = buf[0];

    if (packetType === 1) {
      videoFrames++;
    } else if (packetType === 2) {
      audioPackets++;
      totalAudioBytes += (buf.length - 1);
      if (audioPackets === 1) {
        console.log('First YouTube PCM audio packet received! Size:', buf.length - 1, 'bytes');
      }
      if (audioPackets >= 5) {
        console.log(`SUCCESS: Received ${audioPackets} YouTube audio packets (${totalAudioBytes} bytes) and ${videoFrames} video frames!`);
        ws.close();
        process.exit(0);
      }
    }
  }
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
  process.exit(1);
});

setTimeout(() => {
  if (audioPackets > 0) {
    console.log(`YouTube audio test passed with ${audioPackets} audio packets and ${videoFrames} frames.`);
    ws.close();
    process.exit(0);
  } else {
    console.error(`YouTube audio test timed out. Frames: ${videoFrames}, Audio packets: ${audioPackets}`);
    ws.close();
    process.exit(1);
  }
}, 12000);
