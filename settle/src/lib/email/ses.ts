import { Resend } from 'resend';

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@blipmoney.com';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.error('[Email] RESEND_API_KEY not configured — skipping email');
    return false;
  }

  try {
    const { error } = await getResendClient().emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
    });

    if (error) {
      console.error('[Email] Resend error:', error);
      return false;
    }

    console.log(`[Email] Sent to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send email:', error);
    return false;
  }
}

export function passwordResetEmail(resetLink: string, merchantName: string): { subject: string; html: string; text: string } {
  const subject = 'Reset your Blip Money password';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 0;text-align:center;">
              <h1 style="margin:0;color:#00e676;font-size:24px;font-weight:700;">Blip Money</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px 32px;">
              <h2 style="margin:0 0 16px;color:#ffffff;font-size:20px;">Password Reset</h2>
              <p style="margin:0 0 16px;color:#b0b0b0;font-size:14px;line-height:1.6;">
                Hi <strong style="color:#ffffff;">${merchantName}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#b0b0b0;font-size:14px;line-height:1.6;">
                We received a request to reset your password. Click the button below to create a new password. This link expires in <strong style="color:#ffffff;">15 minutes</strong>.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${resetLink}" style="display:inline-block;background-color:#00e676;color:#000000;font-size:16px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#808080;font-size:12px;">
                If you didn't request this, you can safely ignore this email. Your password won't change.
              </p>
              <p style="margin:0;color:#808080;font-size:12px;word-break:break-all;">
                Link: ${resetLink}
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #2a2a2a;text-align:center;">
              <p style="margin:0;color:#606060;font-size:11px;">
                &copy; ${new Date().getFullYear()} Blip Money. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Hi ${merchantName},\n\nWe received a request to reset your Blip Money password.\n\nReset your password: ${resetLink}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, ignore this email.\n\n— Blip Money`;

  return { subject, html, text };
}
