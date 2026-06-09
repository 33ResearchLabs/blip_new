import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken, ACCESS_TOKEN_COOKIE } from '@/lib/auth/sessionToken';

/**
 * Server-side gate for /faq. Runs before any HTML is sent to the browser,
 * so a logged-out visitor can never even receive the page contents — they
 * are 307-redirected to the landing page at the Next.js layer.
 *
 * The page also carries a client-side probe (see page.tsx) as a second
 * layer that catches sessions revoked AFTER the cookie was minted (the
 * server check here only verifies the HMAC + age of the cookie, not its
 * DB-side revocation state).
 */
export default async function FaqLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!accessToken) {
    redirect('/login');
  }

  const payload = verifySessionToken(accessToken);
  if (!payload || payload.actorType !== 'user') {
    redirect('/login');
  }

  return <>{children}</>;
}
