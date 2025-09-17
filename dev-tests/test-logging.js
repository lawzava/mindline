const WebSocket = require('ws');

console.log('🧪 Testing WebSocket logging connection...');

const ws = new WebSocket('ws://localhost:3001/logs');

ws.on('open', () => {
  console.log('✅ Connected to logging server');

  // Send some test log messages
  const testLogs = [
    { type: 'log', level: 'info', message: 'Test info message from browser', timestamp: new Date().toISOString(), source: 'test' },
    { type: 'log', level: 'warn', message: 'Test warning message', timestamp: new Date().toISOString(), source: 'test' },
    { type: 'log', level: 'error', message: 'Test error message', timestamp: new Date().toISOString(), source: 'test' },
    { type: 'log', level: 'debug', message: 'Test debug message', timestamp: new Date().toISOString(), source: 'test' }
  ];

  testLogs.forEach((log, index) => {
    setTimeout(() => {
      console.log(`📤 Sending: ${log.level} - ${log.message}`);
      ws.send(JSON.stringify(log));
    }, index * 1000);
  });

  // Close connection after all messages are sent
  setTimeout(() => {
    console.log('🔚 Test completed, closing connection');
    ws.close();
  }, testLogs.length * 1000 + 1000);
});

ws.on('close', () => {
  console.log('🔌 Disconnected from logging server');
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
});