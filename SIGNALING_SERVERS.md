# Signaling Server Options for Mindline

## Quick Setup Options

### Option 1: Use URL Parameters (Easiest for Testing)
You can specify a signaling server directly in the URL:
```
http://localhost:8080/?signaling_server=your.server.com:port
```

### Option 2: Environment Variable
Set the `SIGNALING_SERVER` environment variable when building:
```bash
SIGNALING_SERVER=your.server.com:port npm run build
```

### Option 3: Deploy Your Own Free Signaling Server

#### Using Glitch.com (Recommended - Always Free)
1. Go to https://glitch.com
2. Create a new project from this template: https://glitch.com/~mindline-signaling
3. Your server URL will be: `your-project-name.glitch.me`
4. Use it like: `http://localhost:8080/?signaling_server=your-project-name.glitch.me`

#### Using Render.com (Free Tier)
1. Deploy the signaling server from `/signaling-server` folder
2. Free URL format: `your-app.onrender.com`

#### Using Railway.app
1. Connect your GitHub repo
2. Deploy the `/signaling-server` folder
3. Get a free subdomain

### Option 4: Run Local Signaling Server
```bash
# In a separate terminal
cd signaling-server
npm install
npm start
```
Then use `localhost:3000` as your signaling server.

## Privacy Considerations

- **Local Mode**: Without a signaling server, Mindline works in "Local Mode" - messages are stored locally and you can use all features except real-time P2P sync
- **Self-Hosted**: Deploy your own server for maximum privacy
- **URL Parameters**: Good for testing but visible in browser history

## Testing Your Setup

1. Open Mindline in two browser windows
2. Both should show "Connected" status if the signaling server works
3. Join the same room ID in both windows
4. Messages should sync between them

## Troubleshooting

- **"Local Mode" status**: No signaling server configured or unreachable
- **"Disconnected" status**: Not in any room
- **"Connected" status**: Successfully connected to signaling server and P2P network

## For Development

To disable the signaling server and work in local mode, the config has been updated to return `null` by default. You can uncomment line 30 in `/js/config.js` to use localhost:3000 again.