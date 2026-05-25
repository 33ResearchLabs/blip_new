import { NextRequest, NextResponse } from 'next/server';
import { emailVerificationEmail, passwordResetEmail } from '@/lib/email/ses';

// Localhost-only preview route for transactional email templates so you
// can iterate on the HTML in a browser without sending real mail. Hit:
//   http://localhost:3000/dev/emails/verify
//   http://localhost:3000/dev/emails/verify?name=Alex
//   http://localhost:3000/dev/emails/password-reset
// Gated to non-production so it can never leak in prod even if a route
// definition is shipped.

const SAMPLE_VERIFY_LINK =
  'https://app.blip.money/user/verify-email?token=4bd02fc7ba41aa319f26acce55beca9322c59b901ff4e4b2f571824fb420cf6b&id=36895f28-c116-41d9-b24c-6033fd854b42';
const SAMPLE_RESET_LINK =
  'https://app.blip.money/user/reset-password?token=ab12cd34ef56&id=36895f28-c116-41d9-b24c-6033fd854b42';

type Params = { template: string };

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<Params> }
) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 });
  }

  const { template } = await ctx.params;
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || 'zoopweb333';
  const format = url.searchParams.get('format'); // 'text' | 'json' | undefined

  let rendered: { subject: string; html: string; text: string } | null = null;
  switch (template) {
    case 'verify':
    case 'verify-email':
      rendered = emailVerificationEmail(SAMPLE_VERIFY_LINK, name);
      break;
    case 'password-reset':
    case 'reset':
      rendered = passwordResetEmail(SAMPLE_RESET_LINK, name);
      break;
  }

  if (!rendered) {
    return new NextResponse(
      `Unknown template "${template}". Try: /dev/emails/verify or /dev/emails/password-reset`,
      { status: 404 }
    );
  }

  // Rewrite the email's absolute asset URLs (built from NEXT_PUBLIC_APP_URL
  // or the production fallback) to point at the request's own origin so
  // /illustrations/*.png served from /public is reachable in preview no
  // matter how the env is configured.
  const origin = `${url.protocol}//${url.host}`;
  const html = rendered.html.replace(
    /https?:\/\/[^/"']+\/illustrations\//g,
    `${origin}/illustrations/`
  );

  if (format === 'json') {
    return NextResponse.json({ ...rendered, html });
  }
  if (format === 'text') {
    return new NextResponse(rendered.text, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
