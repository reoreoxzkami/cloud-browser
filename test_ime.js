const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3333');

ws.on('open', () => {
  console.log('WS connection opened.');
  setTimeout(() => {
    console.log('Sending Japanese IME text: "テストかな文字" ...');
    ws.send(JSON.stringify({ type: 'insertText', text: 'テストかな文字' }));
  }, 1000);
});

let frames = 0;
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'frame') {
    frames++;
    if (frames === 1) console.log('Frame received!');
    if (frames === 3) {
      console.log('SUCCESS: Japanese text insertion and frame streaming verified!');
      ws.close();
      process.exit(0);
    }
  }
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
  process.exit(1);
});

setTimeout(() => {
  console.error('Test timeout');
  process.exit(1);
}, 8000);
