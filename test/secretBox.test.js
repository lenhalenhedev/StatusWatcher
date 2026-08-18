import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, encryptSecret } from '../src/utils/secretBox.js';

process.env.DB_ENCRYPTION_KEY = 'test-only-long-random-secret-123456789';

test('encrypts and decrypts a secret without storing plaintext', () => {
  const secret = 'postgres://alice:very-secret@example.com:5432/app';
  const encrypted = encryptSecret(secret);
  assert.notEqual(encrypted.ciphertext, secret);
  assert.equal(decryptSecret(encrypted), secret);
});

test('rejects tampered ciphertext and IV/tag', () => {
  const encrypted = encryptSecret('certificate-body');
  const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}aa` };
  assert.throws(() => decryptSecret(tampered), /could not be decrypted/);
  assert.throws(() => decryptSecret({ ...encrypted, tag: 'bad' }), /could not be decrypted/);
});

test('fails closed when encryption key is absent', () => {
  const previous = process.env.DB_ENCRYPTION_KEY;
  delete process.env.DB_ENCRYPTION_KEY;
  assert.throws(() => encryptSecret('secret'), /not configured/);
  process.env.DB_ENCRYPTION_KEY = previous;
});
