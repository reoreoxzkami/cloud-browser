const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('WS connection opened successfully.');
});

let framesReceived = 0;
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'frame') {
    framesReceived++;
    if (framesReceived === 1) {
      console.log('First frame received! Payload length:', msg.data.length);
    }
    if (framesReceived === 3) {
      console.log('Test PASSED! 3 frames received.');
      ws.close();
      process.exit(0);
    }
  } else if (msg.type === 'navigated') {
    console.log('Navigated:', msg.url, 'Title:', msg.title);
  }
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
  process.exit(1);
});

setTimeout(() => {
  console.error('Test timeout');
  process.exit(1);
}, 10000);
