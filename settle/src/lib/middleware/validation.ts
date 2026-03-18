/**
 * Input validation limits for text fields.
 * Applied at API route level to prevent oversized payloads.
 */

export const INPUT_LIMITS = {
  reason: 500,
  description: 2000,
  message: 5000,
  review: 1000,
  username: 50,
  email: 254,
  business_name: 100,
  password: 128,
  payment_details: 2000,
} as const;

/**
 * Validate a string field against its length limit.
 * Returns null if valid, or an error message if too long.
 */
export function validateLength(
  value: string | undefined | null,
  field: keyof typeof INPUT_LIMITS
): string | null {
  if (!value) return null; // empty is OK — required-ness is checked elsewhere
  if (value.length > INPUT_LIMITS[field]) {
    return `${field} exceeds maximum length of ${INPUT_LIMITS[field]} characters`;
  }
  return null;
}

/**
 * Validate multiple fields at once. Returns first error or null.
 */
export function validateFields(
  fields: Array<[string | undefined | null, keyof typeof INPUT_LIMITS]>
): string | null {
  for (const [value, field] of fields) {
    const error = validateLength(value, field);
    if (error) return error;
  }
  return null;
}
