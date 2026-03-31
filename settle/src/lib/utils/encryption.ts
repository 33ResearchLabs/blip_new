/**
 * AES-256-GCM encryption for TOTP secrets.
 * Secrets are encrypted at rest in the database.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.TOTP_ENCRYPTION_KEY;
  if (!key) {
    // Fallback to ADMIN_SECRET (hashed to 32 bytes) for dev environments
    const fallback = process.env.ADMIN_SECRET || process.env.SESSION_TOKEN_SECRET;
    if (!fallback) throw new Error('TOTP_ENCRYPTION_KEY or ADMIN_SECRET must be set');
    const { createHash } = require('crypto');
    return createHash('sha256').update(fallback).digest();
  }
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must be 32 bytes (base64 encoded)');
  return buf;
}

/**
 * Encrypt a plaintext string. Returns base64 string: iv:ciphertext:authTag
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
}

/**
 * Decrypt a string produced by encrypt(). Returns plaintext.
 */
export function decrypt(encryptedStr: string): string {
  const key = getEncryptionKey();
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');

  const [ivHex, ciphertext, authTagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
