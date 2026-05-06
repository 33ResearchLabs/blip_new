/**
 * Security Test Suite: Content-Security-Policy
 *
 * Pins the nonce-based CSP so the previously deployed `'unsafe-inline'` cannot
 * silently come back. Tests the two pure helpers (generateNonce / buildCsp)
 * exported from src/middleware.ts plus a smoke check that the helpers compose
 * into a header that doesn't allow inline script execution.
 */

import { generateNonce, buildCsp } from '../../src/middleware';

describe('generateNonce', () => {
  test('returns a non-empty string', () => {
    const n = generateNonce();
    expect(typeof n).toBe('string');
    expect(n.length).toBeGreaterThan(0);
  });

  test('encodes ≥128 bits of entropy (24-char base64 of 16 bytes)', () => {
    const n = generateNonce();
    // 16 bytes → 24-char base64 incl. padding (Math.ceil(16/3)*4 = 24)
    expect(n.length).toBe(24);
    // Strict base64 charset
    expect(n).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test('produces a unique nonce per call (collision-resistant)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateNonce());
    expect(seen.size).toBe(1000);
  });
});

describe('buildCsp', () => {
  const nonce = 'TESTNONCE1234567890ABCD';
  const csp = buildCsp(nonce);

  test('script-src does NOT contain unsafe-inline (the bug we are fixing)', () => {
    const scriptSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toMatch(/'unsafe-inline'/);
    expect(scriptSrc).not.toMatch(/'unsafe-eval'/);
  });

  test('script-src embeds the per-request nonce', () => {
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toMatch(/script-src[^;]*'nonce-/);
  });

  test('script-src still allows same-origin scripts', () => {
    expect(csp).toMatch(/script-src[^;]*'self'/);
  });

  test('frame-ancestors stays locked down (clickjacking guard)', () => {
    expect(csp).toMatch(/frame-ancestors\s+'none'/);
  });

  test('reporting endpoints are wired up (legacy + Reporting API v2)', () => {
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain('report-to csp-endpoint');
  });

  test('connect-src preserved (regression guard for runtime infra)', () => {
    // If someone removes pusher / helius / cloudinary, websocket + RPC + image
    // upload all break. Pin the contract.
    expect(csp).toMatch(/connect-src[^;]*'self'/);
    expect(csp).toContain('wss:');
    expect(csp).toContain('https://*.helius-rpc.com');
    expect(csp).toContain('https://*.pusher.com');
    expect(csp).toContain('https://api.cloudinary.com');
  });

  test('image / font directives preserved', () => {
    expect(csp).toMatch(/img-src[^;]*'self'/);
    expect(csp).toContain('https://res.cloudinary.com');
    expect(csp).toMatch(/font-src[^;]*'self'/);
  });

  test('different nonces produce different CSP strings', () => {
    const a = buildCsp('AAAAAAAAAAAAAAAAAAAAAA==');
    const b = buildCsp('BBBBBBBBBBBBBBBBBBBBBB==');
    expect(a).not.toEqual(b);
  });

  test('an attacker-supplied empty nonce does not silently re-enable unsafe-inline in script-src', () => {
    // If buildCsp('') ever shipped, browsers would treat `'nonce-'` as a literal
    // nonce of empty string — equivalent to allowing nothing inline. That is a
    // safe default, but pin the contract: 'self' still allows legit same-origin
    // scripts, and 'unsafe-inline' must never appear in script-src for any
    // input. (style-src intentionally retains 'unsafe-inline' — out of scope.)
    const degraded = buildCsp('');
    const degradedScriptSrc =
      degraded.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';
    expect(degradedScriptSrc).toMatch(/'self'/);
    expect(degradedScriptSrc).not.toMatch(/'unsafe-inline'/);
  });
});

describe('CSP integration smoke', () => {
  test('a fresh middleware-style CSP rejects an inline <script> without a nonce', () => {
    // Simulate the policy decision a browser would make: parse script-src and
    // verify the only inline-execution path is through the matching nonce.
    const nonce = generateNonce();
    const csp = buildCsp(nonce);
    const scriptSrc =
      csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';

    // A naive inline `<script>foo()</script>` carries no nonce. Under this
    // CSP, the only token that would let it run is 'unsafe-inline'.
    expect(scriptSrc).not.toMatch(/'unsafe-inline'/);

    // A script tag with the matching nonce IS allowed
    expect(scriptSrc).toContain(`'nonce-${nonce}'`);

    // A script tag with a different nonce is NOT (i.e. only the embedded one matches)
    const wrongNonce = 'XXXXXXXXXXXXXXXXXXXXXXXX';
    expect(scriptSrc).not.toContain(`'nonce-${wrongNonce}'`);
  });
});
