module.exports = {
  apps: [
    {
      name: 'cambios-av-lite',
      script: 'index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      // Reinicia Node antes de que el host de 1GB se quede sin RAM (Chrome va aparte)
      max_memory_restart: '450M',
      node_args: '--max-old-space-size=320 --expose-gc',
      max_restarts: 50,
      min_uptime: '30s',
      restart_delay: 8000,
      kill_timeout: 12000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
