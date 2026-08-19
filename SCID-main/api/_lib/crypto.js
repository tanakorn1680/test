// api/_lib/crypto.js
// encrypt/decrypt ด้วย Node.js crypto — ไม่ต้องพึ่ง pgcrypto config เลย
// AES-256-GCM: authenticated encryption กัน tampering

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain) {
  const key       = getKey();
  const iv        = randomBytes(12);
  const cipher    = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  // format: iv(12 bytes) + authTag(16 bytes) + ciphertext → base64
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(encoded) {
  const key       = getKey();
  const buf       = Buffer.from(encoded, 'base64');
  const iv        = buf.slice(0, 12);
  const authTag   = buf.slice(12, 28);
  const encrypted = buf.slice(28);
  const decipher  = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
