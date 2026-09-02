const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3333');
ws.binaryType = 'arraybuffer';

ws.on('open', () => {
  console.log('WS connection opened for Audio Streaming Test.');
  ws.send(JSON.stringify({ type: 'init', binary: true }));

  setTimeout(() => {
    console.log('Navigating to http://localhost:3333/test_audio.html ...');
    ws.send(JSON.stringify({ type: 'navigate', url: 'http://localhost:3333/test_audio.html' }));

    // Send a click on the page to ensure audio context is active
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
    }, 1200);
  }, 800);
});

let audioPacketsReceived = 0;
let totalAudioBytes = 0;

ws.on('message', (data, isBinary) => {
  if (isBinary || data instanceof Buffer || data instanceof ArrayBuffer) {
    const buf = Buffer.from(data);
    const packetType = buf[0];

    if (packetType === 2) {
      audioPacketsReceived++;
      totalAudioBytes += (buf.length - 1);

      if (audioPacketsReceived === 1) {
        console.log('First audio PCM packet received! Chunk size:', buf.length - 1, 'bytes');
      }

      if (audioPacketsReceived >= 5) {
        console.log(`SUCCESS: Received ${audioPacketsReceived} audio packets (${totalAudioBytes} bytes PCM audio)! Audio streaming verified!`);
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
  if (audioPacketsReceived > 0) {
    console.log(`Test passed with ${audioPacketsReceived} audio packets.`);
    ws.close();
    process.exit(0);
  } else {
    console.error('Audio test timed out: No audio packets received.');
    process.exit(1);
  }
}, 10000);
