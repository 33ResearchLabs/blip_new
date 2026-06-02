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

    // ── settle background workers ─────────────────────────────────────────
    // Promoted from server.js child-process spawns to first-class PM2 apps so
    // each worker is individually SUPERVISED and AUTO-RESTARTED on crash
    // (previously server.js only console.error'd a dead child and never
    // respawned it, while PM2 saw the parent as healthy).
    //
    // CUTOVER (zero double-running): these are inert until you both
    //   (a) start them:   pm2 start ecosystem.config.cjs --only \
    //         settle-payment-deadline,settle-escrow-reconciler,settle-notification-outbox,settle-price-tick,settle-anomaly-sweeper,settle-reputation-worker
    //   (b) tell settle to stop spawning them:  set WORKERS_VIA_PM2=true on the
    //         settle service, then `pm2 reload settle`.
    // Roll back instantly by unsetting WORKERS_VIA_PM2 (server.js resumes
    // spawning) and `pm2 delete` these apps.
    //
    // Each inherits the container env (DATABASE_URL, REDIS_URL, SOLANA_RPC,
    // BACKEND_SIGNER_KEYPAIR, etc.) exactly like the settle/core-api apps above.
    // NOTE: settle-anomaly-sweeper was previously gated behind
    // ENABLE_ERROR_TRACKING/ENABLE_ANOMALY_SWEEPER — start it only when error
    // tracking is enabled (or omit it from the --only list above).
    {
      name: 'settle-payment-deadline',
      cwd: './settle',
      script: 'node_modules/.bin/tsx',
      args: 'src/workers/payment-deadline-worker.ts',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/settle-payment-deadline-error.log',
      out_file: './logs/settle-payment-deadline-out.log',
      merge_logs: true,
      max_memory_restart: '300M',
    },
    {
      name: 'settle-escrow-reconciler',
      cwd: './settle',
      script: 'node_modules/.bin/tsx',
      args: 'src/workers/escrow-reconciler.ts',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/settle-escrow-reconciler-error.log',
      out_file: './logs/settle-escrow-reconciler-out.log',
      merge_logs: true,
      max_memory_restart: '300M',
    },
    {
      name: 'settle-notification-outbox',
      cwd: './settle',
      script: 'node_modules/.bin/tsx',
      args: 'src/workers/notificationOutbox.ts',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/settle-notification-outbox-error.log',
      out_file: './logs/settle-notification-outbox-out.log',
      merge_logs: true,
      max_memory_restart: '256M',
    },
    {
      name: 'settle-price-tick',
      cwd: './settle',
      script: 'node_modules/.bin/tsx',
      args: 'src/workers/price-tick-collector.ts',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/settle-price-tick-error.log',
      out_file: './logs/settle-price-tick-out.log',
      merge_logs: true,
      max_memory_restart: '256M',
    },
    {
      name: 'settle-anomaly-sweeper',
      cwd: './settle',
      script: 'node_modules/.bin/tsx',
      args: 'src/workers/anomaly-sweeper.ts',
      instances: 1,
      exec_mode: 'fork',
      // Observability-only; previously gated by ENABLE_ERROR_TRACKING. Inherits
      // those env vars from the container — start only when error tracking is on.
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/settle-anomaly-sweeper-error.log',
      out_file: './logs/settle-anomaly-sweeper-out.log',
      merge_logs: true,
      max_memory_restart: '256M',
    },
    {
      name: 'settle-reputation-worker',
      cwd: './settle',
      script: 'node_modules/.bin/tsx',
      args: 'src/workers/reputation-worker.ts',
      instances: 1,
      exec_mode: 'fork',
      // SOLE writer of reputation_scores / reputation_history (the leaderboard).
      // In default mode server.js spawns it in-process; under WORKERS_VIA_PM2 it
      // must run here instead, or those tables go stale.
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/settle-reputation-worker-error.log',
      out_file: './logs/settle-reputation-worker-out.log',
      merge_logs: true,
      max_memory_restart: '256M',
    },
  ],
};
