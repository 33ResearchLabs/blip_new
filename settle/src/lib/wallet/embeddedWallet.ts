/**
 * Embedded Wallet Crypto Service
 * Non-custodial keypair management with AES-GCM encryption
 * Keys never leave the browser — encrypted at rest in localStorage
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const STORAGE_KEY = 'blip_embedded_wallet';
const SESSION_KEY = 'blip_wallet_session';
const PBKDF2_ITERATIONS = 100_000;

export interface EncryptedWallet {
  encryptedKey: string; // base64
  iv: string;           // base64
  salt: string;         // base64
  publicKey: string;    // base58
  version: number;
}

/** Generate a new Solana keypair and encrypt it */
export async function generateWallet(password: string): Promise<{ keypair: Keypair; encrypted: EncryptedWallet }> {
  const keypair = Keypair.generate();
  const encrypted = await encryptSecretKey(keypair.secretKey, password, keypair.publicKey.toBase58());
  return { keypair, encrypted };
}

/** Import a wallet from base58 private key and encrypt it */
export async function importWallet(base58PrivateKey: string, password: string): Promise<{ keypair: Keypair; encrypted: EncryptedWallet }> {
  const secretKey = bs58.decode(base58PrivateKey);
  const keypair = Keypair.fromSecretKey(secretKey);
  const encrypted = await encryptSecretKey(keypair.secretKey, password, keypair.publicKey.toBase58());
  return { keypair, encrypted };
}

/** Decrypt an encrypted wallet with password */
export async function decryptWallet(encrypted: EncryptedWallet, password: string): Promise<Keypair> {
  const salt = Uint8Array.from(atob(encrypted.salt), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(encrypted.encryptedKey), c => c.charCodeAt(0));

  const key = await deriveKey(password, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );

  const secretKey = new Uint8Array(decrypted);
  return Keypair.fromSecretKey(secretKey);
}

/** Export keypair as base58 private key */
export function exportPrivateKey(keypair: Keypair): string {
  return bs58.encode(keypair.secretKey);
}

/** Save encrypted wallet to localStorage */
export function saveEncryptedWallet(encrypted: EncryptedWallet): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
}

/** Load encrypted wallet from localStorage */
export function loadEncryptedWallet(): EncryptedWallet | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EncryptedWallet;
  } catch {
    return null;
  }
}

/** Clear encrypted wallet from localStorage */
export function clearEncryptedWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Check if an encrypted wallet exists */
export function hasEncryptedWallet(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/** Save decrypted keypair to localStorage (persists until explicit lock/logout) */
export function saveSessionKeypair(keypair: Keypair): void {
  localStorage.setItem(SESSION_KEY, bs58.encode(keypair.secretKey));
}

/** Load decrypted keypair from localStorage */
export function loadSessionKeypair(): Keypair | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

/** Clear session keypair */
export function clearSessionKeypair(): void {
  localStorage.removeItem(SESSION_KEY);
}

// ---- Internal helpers ----

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptSecretKey(secretKey: Uint8Array, password: string, publicKey: string): Promise<EncryptedWallet> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    secretKey as BufferSource
  );

  return {
    encryptedKey: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt)),
    publicKey,
    version: 1,
  };
}
