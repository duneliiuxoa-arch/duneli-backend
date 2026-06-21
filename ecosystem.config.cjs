// PM2 Ecosystem Config — Duneli Database Server
module.exports = {
  apps: [
    {
      name: 'duneli-db',
      script: 'server.js',
      interpreter: 'node',

      // Auto-restart agar crash ho jaye
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,

      // Environment
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },

      // Logs
      out_file: './pm2-out.log',
      error_file: './pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
