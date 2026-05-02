import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Guard: API routes must not import the full-row merchant fetcher.
  // The `Internal` variant returns auth secrets (password_hash, totp_secret,
  // synthetic_rate, telegram_chat_id, …). Public-facing handlers must use
  // `getMerchantByIdSafe`, which projects to SAFE_MERCHANT_COLUMNS.
  {
    files: ["src/app/api/**/*.ts", "src/app/api/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db/repositories/merchants", "**/repositories/merchants"],
              importNames: ["getMerchantByIdInternal"],
              message:
                "API routes must use getMerchantByIdSafe — the Internal variant returns auth secrets (password_hash, totp_secret, etc.). If you genuinely need them, justify in a comment and add `eslint-disable-next-line no-restricted-imports`.",
            },
          ],
        },
      ],
    },
  },
  // Auth-flow + 2FA routes legitimately need the full row (password / TOTP
  // verification). They are responsible for not echoing those fields back to
  // clients.
  {
    files: [
      "src/app/api/auth/merchant/**/*.ts",
      "src/app/api/2fa/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
