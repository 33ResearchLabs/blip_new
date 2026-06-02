/**
 * MSG91 SMS sender for phone-verification OTPs.
 */

const MSG91_OTP_URL = "https://control.msg91.com/api/v5/otp";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function isSmsConfigured(): boolean {
  return Boolean(env("MSG91_AUTH_KEY") && env("MSG91_TEMPLATE_ID"));
}

interface SendOtpSmsParams {
  phoneNumber: string;
  code: string;
}

export async function sendOtpSms({
  phoneNumber,
  code,
}: SendOtpSmsParams): Promise<boolean> {
  const authkey = env("MSG91_AUTH_KEY");
  const templateId = env("MSG91_TEMPLATE_ID");

  if (!authkey || !templateId) {
    console.error("[SMS] MSG91 not configured", {
      phoneNumber,
    });
    return false;
  }

  // Remove all non-digit characters
  let mobile = phoneNumber.replace(/\D/g, "");

  // Add India country code if user entered only 10 digits
  if (mobile.length === 10) {
    mobile = `91${mobile}`;
  }

  const params = new URLSearchParams({
    template_id: templateId,
    mobile,
    otp: code,
    otp_expiry: "10",
    realTimeResponse: "1",
  });

  try {
    const response = await fetch(`${MSG91_OTP_URL}?${params.toString()}`, {
      method: "POST",
      headers: {
        authkey,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    });

    const data = await response.json().catch(() => ({}));

    console.log("[SMS] MSG91 response", {
      status: response.status,
      statusText: response.statusText,
      data,
    });

    if (!response.ok || data?.type !== "success") {
      console.error("[SMS] MSG91 OTP send failed", {
        phoneNumber,
        status: response.status,
        response: data,
      });

      return false;
    }

    console.log("[SMS] OTP sent successfully", {
      phoneNumber,
      requestId: data?.message,
    });

    return true;
  } catch (error) {
    console.error("[SMS] MSG91 request failed", {
      phoneNumber,
      error: error instanceof Error ? error.message : String(error),
    });

    return false;
  }
}
