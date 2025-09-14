# Hybrid Deployment Guide
## Cloudflare Pages (Frontend) + Hetzner Docker (Signaling Server)

## Architecture Overview

```
┌─────────────────────────────────────┐
│         Cloudflare Pages            │
│  Frontend (HTML/CSS/JS/WASM)        │
│  https://mindline.pages.dev         │
└─────────────────────────────────────┘
                    │
                    │ WebSocket Connection
                    ▼
┌─────────────────────────────────────┐
│         Hetzner Server              │
│  Docker Container                   │
│  Signaling Server (WebSocket)       │
│  wss://signal.yourdomain.com        │
└─────────────────────────────────────┘
```

## **🚀 Part 1: Hetzner Docker Signaling Server**

### 1. Docker Configuration

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  mindline-signaling:
    build: .
    ports:
      - "80:3000"
      - "443:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
    volumes:
      - ./logs:/app/logs
      - ./ssl:/app/ssl
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/ssl/certs:ro
    depends_on:
      - mindline-signaling
    restart: unless-stopped
```

### 2. Signaling Server Dockerfile

Create `Dockerfile.signaling`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --production

# Copy signaling server code
COPY signaling-server.js ./
COPY ecosystem.config.js ./

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start signaling server
CMD ["node", "signaling-server.js"]
```

### 3. Nginx Configuration for SSL

Create `nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    upstream signaling {
        server mindline-signaling:3000;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=websocket:10m rate=10r/s;

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name signal.yourdomain.com;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name signal.yourdomain.com;

        # SSL configuration
        ssl_certificate /etc/ssl/certs/fullchain.pem;
        ssl_certificate_key /etc/ssl/certs/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
        ssl_prefer_server_ciphers off;

        # Security headers
        add_header Strict-Transport-Security "max-age=63072000" always;
        add_header X-Content-Type-Options nosniff;
        add_header X-Frame-Options DENY;

        # WebSocket endpoint
        location /ws {
            limit_req zone=websocket burst=20 nodelay;

            proxy_pass http://signaling;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # WebSocket timeout settings
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # Health check endpoint
        location /health {
            proxy_pass http://signaling;
            proxy_set_header Host $host;
        }
    }
}
```

### 4. Deploy to Hetzner

```bash
# On your Hetzner server:
mkdir mindline-signaling
cd mindline-signaling

# Copy files (using scp or git)
# - docker-compose.yml
# - Dockerfile.signaling
# - nginx.conf
# - signaling-server.js
# - package.json

# Get SSL certificate
sudo apt install certbot
sudo certbot certonly --standalone -d signal.yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/signal.yourdomain.com/*.pem ./ssl/

# Start services
docker-compose up -d

# View logs
docker-compose logs -f
```

## **🌐 Part 2: Cloudflare Pages Frontend**

### 1. Configure Frontend for Production

Update `js/webrtc.js` for production signaling server:

```javascript
// In connect() method:
const protocol = 'wss:'; // Always use secure WebSocket in production
const signalHost = 'signal.yourdomain.com'; // Your Hetzner signaling server
const wsUrl = `${protocol}//${signalHost}/ws`;

console.log(`Connecting to signaling server at ${wsUrl}`);
this.ws = new WebSocket(wsUrl);
```

### 2. Build Script for Cloudflare

Update `package.json`:

```json
{
  "scripts": {
    "build:cloudflare": "npm run build-wasm && webpack --mode production --env cloudflare=true",
    "deploy:cloudflare": "npm run build:cloudflare"
  }
}
```

### 3. Webpack Configuration for Cloudflare

Update `webpack.config.js`:

```javascript
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env) => ({
  mode: env.production ? 'production' : 'development',
  entry: './js/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: env.cloudflare ? '[name].[contenthash].js' : 'index.js',
    clean: true,
    publicPath: '/'
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
      minify: env.production
    })
  ],
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  experiments: {
    asyncWebAssembly: true
  },
  optimization: {
    splitChunks: env.cloudflare ? {
      chunks: 'all'
    } : false
  }
});
```

### 4. Cloudflare Pages Setup

1. **Connect GitHub Repository**:
   ```
   - Go to Cloudflare Dashboard > Pages
   - Connect your GitHub repo
   - Configure build settings
   ```

2. **Build Configuration**:
   ```
   Build command: npm run build:cloudflare
   Build output directory: dist
   Root directory: (leave empty)
   ```

3. **Environment Variables** (in Cloudflare Pages settings):
   ```
   NODE_VERSION: 18
   SIGNALING_SERVER: signal.yourdomain.com
   ```

### 5. Custom Domain (Optional)

Set up custom domain in Cloudflare Pages:
```
Frontend: https://mindline.yourdomain.com
Signaling: wss://signal.yourdomain.com/ws
```

## **🔧 Configuration Files**

### Environment-Specific WebSocket URL

Create `js/config.js`:

```javascript
// Production configuration
const CONFIG = {
  SIGNALING_SERVER: 'signal.yourdomain.com',
  USE_SSL: true,
  WEBSOCKET_PATH: '/ws'
};

// Export for use in webrtc.js
window.MINDLINE_CONFIG = CONFIG;
```

Update `js/webrtc.js`:

```javascript
// Use configuration
const protocol = window.MINDLINE_CONFIG.USE_SSL ? 'wss:' : 'ws:';
const host = window.MINDLINE_CONFIG.SIGNALING_SERVER;
const path = window.MINDLINE_CONFIG.WEBSOCKET_PATH;
const wsUrl = `${protocol}//${host}${path}`;
```

## **📊 Monitoring & Health Checks**

### Hetzner Server Monitoring

```bash
# Check signaling server status
curl https://signal.yourdomain.com/health

# View Docker logs
docker-compose logs -f mindline-signaling

# Monitor connections
docker-compose exec mindline-signaling curl localhost:3000/health
```

### Cloudflare Pages Analytics

- Built-in analytics in Cloudflare Dashboard
- Real User Monitoring (RUM)
- Core Web Vitals tracking

## **🔒 Security Considerations**

### CORS Configuration

Add to signaling server:

```javascript
// In signaling-server.js, add CORS headers
server.on('request', (req, res) => {
  // Set CORS headers for Cloudflare Pages
  res.setHeader('Access-Control-Allow-Origin', 'https://mindline.pages.dev');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy' }));
  }
});
```

### SSL Certificate Auto-Renewal

```bash
# On Hetzner server, add to crontab:
0 12 * * * /usr/bin/certbot renew --quiet && docker-compose restart nginx
```

## **💰 Cost Comparison**

| Component | Platform | Cost |
|-----------|----------|------|
| Frontend | Cloudflare Pages | FREE (100k requests/month) |
| Signaling Server | Hetzner VPS | ~€4/month |
| SSL Certificate | Let's Encrypt | FREE |
| **Total** | | **~€4/month** |

vs. Full Hetzner deployment: ~€4/month (same cost, but better performance!)

## **🚀 Deployment Checklist**

### Hetzner Server:
- [ ] Docker and docker-compose installed
- [ ] Domain DNS pointing to server (signal.yourdomain.com)
- [ ] SSL certificate obtained and configured
- [ ] Docker containers running and healthy
- [ ] WebSocket endpoint responding

### Cloudflare Pages:
- [ ] Repository connected to Cloudflare Pages
- [ ] Build settings configured
- [ ] Custom domain configured (optional)
- [ ] Frontend can connect to signaling server
- [ ] P2P connections working between users

This hybrid approach gives you the best of both worlds! 🎉