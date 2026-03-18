/**
 * Environment variable validation — imported early to fail fast on missing config.
 *
 * Usage: import '@/lib/env' at the top of server.js or layout.tsx
 * Will throw at startup if required vars are missing in production.
 */

const isProduction = process.env.NODE_ENV === 'production';

interface EnvVar {
  key: string;
  required: boolean; // required in production
  secret?: boolean;  // mask value in logs
}

const ENV_SCHEMA: EnvVar[] = [
  // Database — either DATABASE_URL or individual vars
  // (checked separately below)

  // Security (required in production)
  { key: 'ADMIN_SECRET', required: true, secret: true },
  { key: 'ADMIN_PASSWORD', required: true, secret: true },
  { key: 'COMPLIANCE_PASSWORD', required: true, secret: true },
  { key: 'CORE_API_SECRET', required: true, secret: true },

  // External services
  { key: 'PUSHER_APP_ID', required: true },
  { key: 'PUSHER_SECRET', required: true, secret: true },
  { key: 'NEXT_PUBLIC_PUSHER_KEY', required: true },
  { key: 'NEXT_PUBLIC_PUSHER_CLUSTER', required: true },

  // Cloudinary
  { key: 'CLOUDINARY_CLOUD_NAME', required: true },
  { key: 'CLOUDINARY_API_KEY', required: true, secret: true },
  { key: 'CLOUDINARY_API_SECRET', required: true, secret: true },

  // Solana
  { key: 'NEXT_PUBLIC_SOLANA_RPC_URL', required: true },

  // CORS (required in production — must be set to real domain)
  { key: 'CORS_ORIGIN', required: true },

  // Telegram (notifications)
  { key: 'TELEGRAM_BOT_TOKEN', required: false, secret: true },
];

export function validateEnv(): { valid: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check database: need either DATABASE_URL or DB_HOST+DB_NAME+DB_USER
  const hasDbUrl = !!process.env.DATABASE_URL;
  const hasDbParts = !!process.env.DB_HOST && !!process.env.DB_NAME && !!process.env.DB_USER;
  if (!hasDbUrl && !hasDbParts) {
    if (isProduction) {
      missing.push('DATABASE_URL (or DB_HOST+DB_NAME+DB_USER)');
    } else {
      warnings.push('DATABASE_URL (or DB_HOST+DB_NAME+DB_USER)');
    }
  }

  for (const { key, required } of ENV_SCHEMA) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      if (required && isProduction) {
        missing.push(key);
      } else if (required) {
        warnings.push(key);
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

// Auto-validate on import — crash in production if critical vars are missing
const _envResult = validateEnv();
if (isProduction && !_envResult.valid) {
  const msg = `[env] FATAL: Missing required environment variables: ${_envResult.missing.join(', ')}`;
  console.error(msg);
  console.error('[env] Server cannot start without these.');
  // Crash server-side only (Edge/Node); on client this is a no-op
  if (typeof process !== 'undefined' && typeof process.exit === 'function') {
    process.exit(1);
  }
  throw new Error(msg);
} else if (_envResult.warnings.length > 0) {
  console.warn(
    `[env] Missing recommended variables: ${_envResult.warnings.join(', ')}`
  );
}
