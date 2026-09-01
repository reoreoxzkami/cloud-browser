const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3333');
ws.binaryType = 'arraybuffer';

ws.on('open', () => {
  console.log('Binary WS connection established.');
});

let frames = 0;
ws.on('message', (data, isBinary) => {
  if (data instanceof Buffer || data instanceof ArrayBuffer) {
    frames++;
    if (frames === 1) {
      console.log('Received raw binary frame! Byte length:', data.byteLength || data.length);
    }
    if (frames === 5) {
      console.log('Successfully received 5 binary frames. Binary optimization verified!');
      ws.close();
      process.exit(0);
    }
  }
});

ws.on('error', (e) => {
  console.error('WS error:', e);
  process.exit(1);
});

setTimeout(() => {
  console.error('Binary test timed out');
  process.exit(1);
}, 8000);
