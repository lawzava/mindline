const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer();

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Log file path
const logFile = path.join(logsDir, 'browser.log');

// WebSocket server for logging
const wss = new WebSocket.Server({
  server,
  path: '/logs',
  perMessageDeflate: false,
  maxPayload: 64 * 1024 // 64KB max payload for logs
});

// Function to write log to file and console
function writeLog(logData) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${logData.level.toUpperCase()}: ${logData.message}\n`;

  // Write to file
  fs.appendFile(logFile, logEntry, (err) => {
    if (err) console.error('Error writing to log file:', err);
  });

  // Also output to console for real-time monitoring
  console.log(`🌐 ${logData.level.toUpperCase()}: ${logData.message}`);
}

wss.on('connection', (ws) => {
  console.log('📱 Browser connected to logging server');

  ws.on('message', (message) => {
    try {
      const logData = JSON.parse(message);

      if (logData.type === 'log') {
        writeLog({
          level: logData.level || 'info',
          message: logData.message || 'No message',
          timestamp: logData.timestamp || new Date().toISOString(),
          source: logData.source || 'browser'
        });
      }
    } catch (error) {
      console.error('Error parsing log message:', error);
    }
  });

  ws.on('close', () => {
    console.log('📱 Browser disconnected from logging server');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// HTTP endpoint to get recent logs
server.on('request', (req, res) => {
  // CORS headers
  const allowedOrigins = [
    'http://localhost:8080',
    'http://localhost:8088',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:8088'
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/logs/recent') {
    // Read last 100 lines of log file
    fs.readFile(logFile, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not read log file' }));
        return;
      }

      const lines = data.split('\n').filter(line => line.trim()).slice(-100);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: lines }));
    });
  } else if (req.url === '/logs/clear') {
    // Clear log file
    fs.writeFile(logFile, '', (err) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not clear log file' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Log file cleared' }));
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const PORT = process.env.LOG_PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`📝 Mindline Logging Server`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Host: ${HOST}`);
  console.log(`   WebSocket Path: /logs`);
  console.log(`   Log File: ${logFile}`);
  console.log(`   Endpoints:`);
  console.log(`     GET /logs/recent - Get recent logs`);
  console.log(`     GET /logs/clear - Clear log file`);
  console.log(`   Ready for connections!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Shutting down logging server...');
  server.close(() => {
    console.log('✅ Logging server shutdown complete');
    process.exit(0);
  });
});