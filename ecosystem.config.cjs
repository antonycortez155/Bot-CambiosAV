module.exports = {
  apps: [
    {
      name: 'cambios-av-lite',
      script: 'index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      node_args: '--max-old-space-size=384 --expose-gc',
      max_restarts: 50,
      min_uptime: '30s',
      restart_delay: 8000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
