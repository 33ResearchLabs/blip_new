-- Store the reCAPTCHA Enterprise assessment ID so we can annotate it
-- after OTP send (INITIATED), verify (PASSED), or failure (FAILED).
ALTER TABLE phone_otp_codes
  ADD COLUMN IF NOT EXISTS assessment_id TEXT;
