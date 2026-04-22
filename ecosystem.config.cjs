/**
 * PM2 Ecosystem Config — Blip Money
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 start ecosystem.config.cjs --only settle
 *   pm2 start ecosystem.config.cjs --only core-api
 *   pm2 start ecosystem.config.cjs --only blipscan-web
 *   pm2 start ecosystem.config.cjs --only blipscan-indexer
 *   pm2 logs
 *   pm2 monit
 */

module.exports = {
  apps: [
    {
      name: 'settle',
      cwd: './settle',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4545,
      },
      // Restart on crash, max 10 restarts in 60s
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      // Logs
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/settle-error.log',
      out_file: './logs/settle-out.log',
      merge_logs: true,
      // Memory limit — restart if exceeds 512MB
      max_memory_restart: '512M',
    },
    {
      name: 'core-api',
      cwd: './apps/core-api',
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        CORE_API_PORT: 4010,
      },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/core-api-error.log',
      out_file: './logs/core-api-out.log',
      merge_logs: true,
      max_memory_restart: '256M',
    },
    {
      name: 'blipscan-web',
      cwd: './blipscan/web',
      script: 'node_modules/.bin/next',
      args: 'start -p 3001',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/blipscan-web-error.log',
      out_file: './logs/blipscan-web-out.log',
      merge_logs: true,
      max_memory_restart: '256M',
    },
    {
      name: 'blipscan-indexer',
      cwd: './blipscan/indexer',
      script: 'node_modules/.bin/ts-node',
      args: 'src/index.ts',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/blipscan-indexer-error.log',
      out_file: './logs/blipscan-indexer-out.log',
      merge_logs: true,
      max_memory_restart: '256M',
    },
  ],
};
