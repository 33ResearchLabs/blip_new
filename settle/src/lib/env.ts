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
  // Database
  { key: 'DB_HOST', required: true },
  { key: 'DB_NAME', required: true },
  { key: 'DB_USER', required: true },

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
];

export function validateEnv(): { valid: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

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

// Auto-validate on import in production — fail fast
if (isProduction) {
  const result = validateEnv();
  if (!result.valid) {
    throw new Error(
      `FATAL: Missing required environment variables: ${result.missing.join(', ')}`
    );
  }
}
