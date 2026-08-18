import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const SALT = 'statuswatcher-database-secrets-v1';

function getKey() {
  const raw = String(process.env.DB_ENCRYPTION_KEY ?? '');
  if (raw.length < 16) {
    throw new Error('Database secret encryption is not configured.');
  }
  return scryptSync(raw, SALT, KEY_LENGTH);
}

export function encryptSecret(value) {
  const plaintext = Buffer.from(String(value ?? ''), 'utf8');
  if (plaintext.length === 0) throw new Error('Secret cannot be empty.');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret({ ciphertext, iv, tag }) {
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(String(iv), 'base64'),
    );
    decipher.setAuthTag(Buffer.from(String(tag), 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(String(ciphertext), 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Database secret could not be decrypted.');
  }
}

export function canEncryptSecrets() {
  return String(process.env.DB_ENCRYPTION_KEY ?? '').length >= 16;
}

export const SECRET_BOX_ALGORITHM = ALGORITHM;
