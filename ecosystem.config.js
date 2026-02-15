module.exports = {
  apps: [{
    name: 'mindline-signaling',
    script: 'signaling-server.js',
    env: {
      PORT: 3000,
      HOST: '0.0.0.0',
      NODE_ENV: 'production',
      RATE_LIMIT_MESSAGES_PER_SECOND: 50,
      RATE_LIMIT_CONNECTION_ATTEMPTS_PER_MINUTE: 240,
      RATE_LIMIT_ROOM_JOINS_PER_MINUTE: 30
    },
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '512M',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    restart_delay: 1000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
