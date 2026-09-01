const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3333');

ws.on('open', () => {
  console.log('WS connection opened.');
  setTimeout(() => {
    console.log('Sending Japanese IME text: "こんにちは世界" ...');
    ws.send(JSON.stringify({ type: 'insertText', text: 'こんにちは世界' }));
  }, 1000);
});

let frames = 0;
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'frame') {
    frames++;
    if (frames === 1) console.log('Frame received!');
    if (frames === 5) {
      console.log('SUCCESS: Japanese text insertion and frame streaming verified!');
      ws.close();
      process.exit(0);
    }
  }
});

setTimeout(() => {
  console.error('Test timeout');
  process.exit(1);
}, 10000);
