module.exports = {
  apps: [{
    name: 'mindline-signaling',
    script: 'signaling-server.js',
    env: {
      PORT: 3000,
      HOST: '0.0.0.0',
      NODE_ENV: 'production'
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