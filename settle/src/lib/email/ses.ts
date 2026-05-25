import { Resend } from 'resend';

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@blipmoney.com';

// Origin used to build absolute URLs for email image assets. Email
// clients can't resolve relative paths, so every <img src> must be
// absolute. NEXT_PUBLIC_APP_URL is set per environment
// (http://localhost:3000 in dev, https://app.blip.money in prod) so the
// localhost preview route fetches local images while production mail
// uses CDN-served assets.
const ASSET_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.blip.money').replace(/\/$/, '');

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.error('[Email] RESEND_API_KEY not configured — skipping email', { to, subject });
    return false;
  }

  try {
    const { data, error } = await getResendClient().emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
    });

    if (error) {
      // Resend error shape includes name/message/statusCode — log all of them
      // so support can tell domain-not-verified vs invalid-recipient vs
      // rate-limited vs upstream outage at a glance.
      console.error('[Email] Resend rejected the send', {
        to,
        subject,
        from: FROM_EMAIL,
        errorName: (error as any)?.name,
        errorMessage: (error as any)?.message,
        statusCode: (error as any)?.statusCode,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Email] sendEmail threw — likely network/SDK bug', {
      to,
      subject,
      from: FROM_EMAIL,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function emailVerificationEmail(verifyLink: string, merchantName: string): { subject: string; html: string; text: string } {
  const subject = 'Confirm your Blip account';
  const year = new Date().getFullYear();
  const safeName = (merchantName || 'there').trim();

  // Email-client-safe HTML: nested tables, inline styles, no flex/grid,
  // no web fonts (Outlook strips @import). Visuals mirror the
  // blip.money waitlist aesthetic — dark brand strip on top, warm
  // off-white card, copper accent dot, single primary CTA.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <!--[if mso]>
  <style type="text/css">body,table,td,p,a {font-family:Arial,Helvetica,sans-serif !important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#FAF8F5;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
  <span style="display:none !important;visibility:hidden;mso-hide:all;max-height:0;overflow:hidden;opacity:0;color:transparent;">Confirm your email to activate your Blip account — link expires in 24 hours.</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF8F5;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Minimal brand line (outside the card, like the waitlist navbar) -->
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;margin-bottom:18px;">
          <tr>
            <td align="left" valign="middle" style="font-size:18px;letter-spacing:-0.045em;color:#1d1d1f;">
              <span style="font-weight:700;">Blip</span><span style="font-style:italic;font-weight:600;margin-left:3px;">money</span>
            </td>
            <td align="right" valign="middle" style="font-family:ui-monospace,SFMono-Regular,Menlo,'Courier New',monospace;font-size:9.5px;font-weight:600;letter-spacing:0.22em;color:rgba(29,29,31,0.55);">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#cc785c;vertical-align:middle;margin-right:7px;"></span>MAINNET&nbsp;·&nbsp;LIVE
            </td>
          </tr>
        </table>

        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid rgba(29,29,31,0.06);box-shadow:0 24px 50px -28px rgba(0,0,0,0.18);">

            <!-- Hero image -->
            <tr>
              <td align="center" style="background:#FAF8F5;padding:44px 28px 0;">
                <img src="${ASSET_ORIGIN}/illustrations/verify-email-hero.png"
                     alt=""
                     width="220"
                     height="220"
                     style="display:block;width:220px;height:220px;border-radius:28px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
              </td>
            </tr>

            <!-- Eyebrow + headline (closes the cream hero block) -->
            <tr>
              <td align="center" style="background:#FAF8F5;padding:24px 40px 8px;">
                <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#cc785c;">Confirm your email</p>
                <h1 style="margin:0;font-size:34px;line-height:1.05;letter-spacing:-0.03em;font-weight:600;color:#1d1d1f;">
                  One tap to <span style="font-style:italic;font-weight:500;color:#cc785c;">unlock your account.</span>
                </h1>
              </td>
            </tr>

            <!-- Spacer + hairline copper rule separating cream hero from white body -->
            <tr>
              <td style="background:#FAF8F5;padding:32px 40px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td height="1" style="line-height:1px;font-size:1px;background:rgba(204,120,92,0.18);">&nbsp;</td>
                </tr></table>
              </td>
            </tr>
            <tr><td style="background:#FAF8F5;height:0;line-height:0;font-size:0;">&nbsp;</td></tr>

            <!-- Body -->
            <tr>
              <td style="padding:28px 40px 0;">
                <p style="margin:0 0 14px;font-size:15.5px;line-height:1.55;color:#3a3a3c;">
                  Hi <strong style="color:#1d1d1f;">${safeName}</strong> — welcome aboard. Confirm this address and we'll activate your account, credit your signup bonus, and unlock the dashboard.
                </p>
                <p style="margin:0;font-size:13px;line-height:1.55;color:#6e6e73;">
                  Link expires in <strong style="color:#1d1d1f;">24 hours</strong>. If it does, request a new one from the sign-in page.
                </p>
              </td>
            </tr>

            <!-- CTA -->
            <tr>
              <td align="center" style="padding:32px 40px 10px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="border-radius:999px;background:#0a0a0a;box-shadow:0 8px 22px -10px rgba(10,10,10,0.45);">
                      <a href="${verifyLink}" target="_blank" rel="noopener" style="display:inline-block;padding:16px 36px;font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#ffffff;text-decoration:none;border-radius:999px;">
                        Confirm email&nbsp;&nbsp;→
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Fallback link -->
            <tr>
              <td style="padding:6px 40px 28px;" align="center">
                <p style="margin:0;font-size:11px;color:#a0a0a4;letter-spacing:0.02em;">Or paste this link into your browser</p>
                <p style="margin:6px 0 0;font-size:11.5px;line-height:1.5;word-break:break-all;">
                  <a href="${verifyLink}" target="_blank" rel="noopener" style="color:#cc785c;text-decoration:underline;">${verifyLink}</a>
                </p>
              </td>
            </tr>

            <!-- Bonus pill — copper-tinted ink bubble so the accent threads through the layout -->
            <tr>
              <td style="padding:0 28px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg, rgba(204,120,92,0.10) 0%, rgba(204,120,92,0.03) 100%);border:1px solid rgba(204,120,92,0.22);border-radius:16px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="44" valign="middle" style="padding-right:14px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="38" height="38" style="background:#cc785c;border-radius:12px;color:#ffffff;font-size:18px;font-weight:700;line-height:38px;">★</td></tr></table>
                          </td>
                          <td valign="middle">
                            <div style="font-size:14px;font-weight:700;letter-spacing:-0.01em;color:#1d1d1f;">Signup bonus is waiting</div>
                            <div style="font-size:11.5px;color:#6e6e73;margin-top:2px;">Credited the moment you confirm this email.</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 28px 26px;background:#fafafa;border-top:1px solid rgba(29,29,31,0.06);">
                <p style="margin:0 0 10px;font-size:11.5px;color:#8a8a8e;line-height:1.55;">
                  Didn't sign up? Ignore this email — no account was created. Questions? Just reply, we read every message.
                </p>
                <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,'Courier New',monospace;font-size:10px;letter-spacing:0.22em;color:#8a8a8e;text-transform:uppercase;">
                  © ${year} BLIP.MONEY &nbsp;·&nbsp; Fast. Simple. Blip.
                </p>
              </td>
            </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${safeName},`,
    '',
    `Welcome to Blip. Confirm your email to activate your account — your signup bonus is credited the moment you click.`,
    '',
    `Confirm: ${verifyLink}`,
    '',
    `This link expires in 24 hours.`,
    '',
    `Didn't sign up? Ignore this email — no account was created.`,
    '',
    `— Blip Money`,
  ].join('\n');

  return { subject, html, text };
}

export function passwordResetEmail(resetLink: string, merchantName: string): { subject: string; html: string; text: string } {
  const subject = 'Reset your Blip password';
  const year = new Date().getFullYear();
  const safeName = (merchantName || 'there').trim();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <!--[if mso]>
  <style type="text/css">body,table,td,p,a {font-family:Arial,Helvetica,sans-serif !important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#FAF8F5;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
  <span style="display:none !important;visibility:hidden;mso-hide:all;max-height:0;overflow:hidden;opacity:0;color:transparent;">A password-reset link for your Blip account. Expires in 15 minutes.</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF8F5;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;margin-bottom:18px;">
          <tr>
            <td align="left" valign="middle" style="font-size:18px;letter-spacing:-0.045em;color:#1d1d1f;">
              <span style="font-weight:700;">Blip</span><span style="font-style:italic;font-weight:600;margin-left:3px;">money</span>
            </td>
            <td align="right" valign="middle" style="font-family:ui-monospace,SFMono-Regular,Menlo,'Courier New',monospace;font-size:9.5px;font-weight:600;letter-spacing:0.22em;color:rgba(29,29,31,0.55);">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#cc785c;vertical-align:middle;margin-right:7px;"></span>MAINNET&nbsp;·&nbsp;LIVE
            </td>
          </tr>
        </table>

        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid rgba(29,29,31,0.06);box-shadow:0 24px 50px -28px rgba(0,0,0,0.18);">

            <!-- Hero image -->
            <tr>
              <td align="center" style="background:#FAF8F5;padding:44px 28px 0;">
                <img src="${ASSET_ORIGIN}/illustrations/reset-password-hero.png"
                     alt=""
                     width="220"
                     height="220"
                     style="display:block;width:220px;height:220px;border-radius:28px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
              </td>
            </tr>

            <!-- Eyebrow + headline (closes the cream hero block) -->
            <tr>
              <td align="center" style="background:#FAF8F5;padding:24px 40px 8px;">
                <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#cc785c;">Reset your password</p>
                <h1 style="margin:0;font-size:34px;line-height:1.05;letter-spacing:-0.03em;font-weight:600;color:#1d1d1f;">
                  A fresh key for <span style="font-style:italic;font-weight:500;color:#cc785c;">your account.</span>
                </h1>
              </td>
            </tr>

            <!-- Hairline copper rule -->
            <tr>
              <td style="background:#FAF8F5;padding:32px 40px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td height="1" style="line-height:1px;font-size:1px;background:rgba(204,120,92,0.18);">&nbsp;</td>
                </tr></table>
              </td>
            </tr>
            <tr><td style="background:#FAF8F5;height:0;line-height:0;font-size:0;">&nbsp;</td></tr>

            <!-- Body -->
            <tr>
              <td style="padding:28px 40px 0;">
                <p style="margin:0 0 14px;font-size:15.5px;line-height:1.55;color:#3a3a3c;">
                  Hi <strong style="color:#1d1d1f;">${safeName}</strong> — we got a request to reset the password on your Blip account. Tap below to pick a new one. Your wallet, balances, and trade history stay exactly as you left them.
                </p>
                <p style="margin:0;font-size:13px;line-height:1.55;color:#6e6e73;">
                  Link expires in <strong style="color:#1d1d1f;">15 minutes</strong> for your security.
                </p>
              </td>
            </tr>

            <!-- CTA -->
            <tr>
              <td align="center" style="padding:32px 40px 10px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="border-radius:999px;background:#0a0a0a;box-shadow:0 8px 22px -10px rgba(10,10,10,0.45);">
                      <a href="${resetLink}" target="_blank" rel="noopener" style="display:inline-block;padding:16px 36px;font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#ffffff;text-decoration:none;border-radius:999px;">
                        Reset password&nbsp;&nbsp;→
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Fallback link -->
            <tr>
              <td style="padding:6px 40px 28px;" align="center">
                <p style="margin:0;font-size:11px;color:#a0a0a4;letter-spacing:0.02em;">Or paste this link into your browser</p>
                <p style="margin:6px 0 0;font-size:11.5px;line-height:1.5;word-break:break-all;">
                  <a href="${resetLink}" target="_blank" rel="noopener" style="color:#cc785c;text-decoration:underline;">${resetLink}</a>
                </p>
              </td>
            </tr>

            <!-- Security pill -->
            <tr>
              <td style="padding:0 28px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg, rgba(204,120,92,0.10) 0%, rgba(204,120,92,0.03) 100%);border:1px solid rgba(204,120,92,0.22);border-radius:16px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="44" valign="middle" style="padding-right:14px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="38" height="38" style="background:#cc785c;border-radius:12px;color:#ffffff;font-size:18px;font-weight:700;line-height:38px;">⌁</td></tr></table>
                          </td>
                          <td valign="middle">
                            <div style="font-size:14px;font-weight:700;letter-spacing:-0.01em;color:#1d1d1f;">Single-use link</div>
                            <div style="font-size:11.5px;color:#6e6e73;margin-top:2px;">Burned the moment you open it. Won't work twice.</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 28px 26px;background:#fafafa;border-top:1px solid rgba(29,29,31,0.06);">
                <p style="margin:0 0 10px;font-size:11.5px;color:#8a8a8e;line-height:1.55;">
                  Didn't ask to reset? Ignore this email — your current password stays unchanged. If they keep coming, reply and we'll investigate.
                </p>
                <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,'Courier New',monospace;font-size:10px;letter-spacing:0.22em;color:#8a8a8e;text-transform:uppercase;">
                  © ${year} BLIP.MONEY &nbsp;·&nbsp; Fast. Simple. Blip.
                </p>
              </td>
            </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${safeName},`,
    '',
    `We got a request to reset your Blip password.`,
    '',
    `Reset: ${resetLink}`,
    '',
    `This link expires in 15 minutes.`,
    '',
    `Didn't ask for this? Ignore this email — your password stays unchanged.`,
    '',
    `— Blip`,
  ].join('\n');

  return { subject, html, text };
}
