const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('WS connection opened.');
  setTimeout(() => {
    console.log('Sending navigate command to https://example.com ...');
    ws.send(JSON.stringify({ type: 'navigate', url: 'https://example.com' }));
  }, 1500);
});

ws.on('message', (data, isBinary) => {
  if (isBinary) return;
  try {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'navigated') {
      console.log('Page title/url changed:', msg.url, 'Title:', msg.title);
      if (msg.url.includes('example.com')) {
        console.log('SUCCESS: Navigation to example.com confirmed!');
        ws.close();
        process.exit(0);
      }
    }
  } catch (e) {}
});

setTimeout(() => {
  console.error('Test timeout');
  process.exit(1);
}, 12000);
