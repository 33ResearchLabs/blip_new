/**
 * Next.js instrumentation hook — runs once at server startup.
 * Used for env validation and early diagnostics.
 */
export async function register() {
  // Validate required environment variables (exits process in production if missing)
  await import('@/lib/env');
}
