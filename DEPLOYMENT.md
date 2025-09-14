# Mindline Production Deployment Guide

## Deployment Architecture

```
┌─────────────────────────────────────┐
│          Hetzner Server             │
├─────────────────────────────────────┤
│  Nginx (Port 80/443)               │
│  ├─ Static Files (Mindline App)     │
│  └─ Reverse Proxy to Node.js       │
├─────────────────────────────────────┤
│  Node.js Signaling Server          │
│  └─ WebSocket on Port 3000         │
├─────────────────────────────────────┤
│  SSL/TLS (Let's Encrypt)           │
│  └─ Required for WebRTC            │
└─────────────────────────────────────┘
```

## **🚀 Quick Deployment (Recommended)**

### Prerequisites
- Hetzner server with Ubuntu/Debian
- Domain name pointing to your server
- Root/sudo access

### 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install nginx and certbot
sudo apt install nginx certbot python3-certbot-nginx -y

# Install PM2 for process management
sudo npm install -g pm2

# Create app user
sudo useradd -m -s /bin/bash mindline
sudo usermod -aG www-data mindline
```

### 2. Deploy Application

```bash
# Clone/upload your code to server
sudo mkdir -p /var/www/mindline
sudo chown mindline:www-data /var/www/mindline
cd /var/www/mindline

# Upload your built application
# (scp, rsync, or git clone)

# Install dependencies
npm install --production

# Build application for production
npm run build
```

### 3. Configure Nginx

Create `/etc/nginx/sites-available/mindline`:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL configuration (will be added by certbot)

    # Serve static files
    location / {
        root /var/www/mindline/dist;
        try_files $uri $uri/ /index.html;

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|wasm)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # WebSocket proxy for signaling server
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 4. Setup SSL Certificate

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/mindline /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### 5. Configure PM2 for Production

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'mindline-signaling',
    script: 'signaling-server.js',
    env: {
      PORT: 3000,
      NODE_ENV: 'production'
    },
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
}
```

Start with PM2:
```bash
# Create logs directory
mkdir -p logs

# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u mindline --hp /home/mindline
```

## **📦 Alternative: Docker Deployment**

### Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Install wasm-pack for building
RUN apk add --no-cache curl
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Copy source code
COPY . .

# Build application
RUN npm run build

EXPOSE 3000 8080

# Start both servers
CMD ["npm", "run", "start:production"]
```

### Docker Compose
```yaml
version: '3.8'
services:
  mindline:
    build: .
    ports:
      - "80:8080"
      - "3000:3000"
    environment:
      - NODE_ENV=production
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl
    depends_on:
      - mindline
    restart: unless-stopped
```

## **🔧 Production Configuration**

### Update package.json
Add production scripts:

```json
{
  "scripts": {
    "start:production": "concurrently \"npm run serve\" \"npm run signaling\"",
    "serve": "http-server dist -p 8080",
    "signaling": "node signaling-server.js",
    "build:production": "npm run build"
  },
  "dependencies": {
    "concurrently": "^7.6.0",
    "http-server": "^14.1.1"
  }
}
```

### Environment Variables
Create `.env` file:

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DOMAIN=yourdomain.com
SSL_ENABLED=true
```

### Update signaling server for production
Modify `signaling-server.js`:

```javascript
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const server = http.createServer();

// Update WebSocket server with proper configuration
const wss = new WebSocket.Server({
  server,
  path: '/ws',
  perMessageDeflate: false
});

// Production port configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`🚀 Signaling server running on ${HOST}:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
```

### Update frontend WebSocket URL
Modify `js/webrtc.js` for production:

```javascript
// In connect() method, update WebSocket URL logic:
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.hostname;
const wsUrl = `${protocol}//${host}/ws`; // Use /ws path for nginx proxy
```

## **🔍 Health Monitoring**

### PM2 Monitoring
```bash
# View logs
pm2 logs mindline-signaling

# Monitor performance
pm2 monit

# Restart if needed
pm2 restart mindline-signaling

# View status
pm2 status
```

### Nginx Logs
```bash
# Access logs
sudo tail -f /var/log/nginx/access.log

# Error logs
sudo tail -f /var/log/nginx/error.log
```

## **🛡 Security Considerations**

### Firewall Setup
```bash
# Allow only necessary ports
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

### Rate Limiting (Nginx)
Add to nginx config:
```nginx
# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=websocket:10m rate=5r/s;

# In server block:
location /ws {
    limit_req zone=websocket burst=10 nodelay;
    # ... rest of websocket config
}
```

## **📊 Performance Optimization**

### Nginx Compression
```nginx
# Enable gzip compression
gzip on;
gzip_vary on;
gzip_types
    text/plain
    text/css
    text/xml
    text/javascript
    application/javascript
    application/wasm
    application/xml+rss;
```

### WASM Optimization
Ensure proper MIME type in nginx:
```nginx
location ~* \.wasm$ {
    add_header Content-Type application/wasm;
    expires 1y;
}
```

## **✅ Deployment Checklist**

- [ ] Domain DNS pointing to server
- [ ] SSL certificate installed and working
- [ ] Signaling server running on port 3000
- [ ] Nginx serving static files
- [ ] WebSocket proxy working (/ws endpoint)
- [ ] PM2 managing Node.js process
- [ ] Firewall configured
- [ ] Rate limiting enabled
- [ ] Logs rotating properly
- [ ] Health monitoring setup

## **🚀 Quick Deploy Script**

Want me to create an automated deployment script that handles all of this? Just let me know your domain name and I can generate a complete setup script!