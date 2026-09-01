const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3333');

ws.on('open', () => {
  console.log('WS connection opened successfully.');
  ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
});

let framesReceived = 0;

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'pong') {
    console.log('Received PONG, RTT:', Date.now() - msg.timestamp, 'ms');
  } else if (msg.type === 'frame') {
    framesReceived++;
    if (framesReceived === 1) {
      console.log('Received first video frame! (Base64 JPEG payload length:', msg.data.length, ')');
    }
    if (framesReceived === 5) {
      console.log('Successfully received 5 frames in real-time. Test PASSED!');
      ws.close();
      process.exit(0);
    }
  } else if (msg.type === 'navigated') {
    console.log('Page navigated:', msg.url, 'Title:', msg.title);
  }
});

ws.on('error', (err) => {
  console.error('WS error:', err);
  process.exit(1);
});

setTimeout(() => {
  console.error('Test timeout!');
  process.exit(1);
}, 10000);
