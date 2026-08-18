import { createHash, randomUUID } from 'node:crypto';
import db from '../utils/db.js';
import { encryptSecret, decryptSecret } from '../utils/secretBox.js';
import { logError } from '../utils/logger.js';

const now = () => Date.now();

db.exec(`
  CREATE TABLE IF NOT EXISTS database_targets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    engine TEXT NOT NULL,
    connection_ciphertext TEXT NOT NULL,
    connection_iv TEXT NOT NULL,
    connection_tag TEXT NOT NULL,
    ssl_enabled INTEGER NOT NULL DEFAULT 0 CHECK (ssl_enabled IN (0, 1)),
    certificate_ciphertext TEXT,
    certificate_iv TEXT,
    certificate_tag TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    certificate_uploaded_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS database_certificate_requests (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (target_id) REFERENCES database_targets (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_database_certificate_requests_active
    ON database_certificate_requests (user_id, expires_at);
`);

const stmtList = db.prepare(`
  SELECT id, name, engine, ssl_enabled, certificate_ciphertext, created_at, updated_at, certificate_uploaded_at
  FROM database_targets ORDER BY created_at, id
`);
const stmtGet = db.prepare('SELECT * FROM database_targets WHERE id = ?');
const stmtInsert = db.prepare(`
  INSERT INTO database_targets (
    id, name, engine, connection_ciphertext, connection_iv, connection_tag,
    ssl_enabled, created_at, updated_at
  ) VALUES (@id, @name, @engine, @connection_ciphertext, @connection_iv, @connection_tag, @ssl_enabled, @now, @now)
`);
const stmtDelete = db.prepare('DELETE FROM database_targets WHERE id = ?');
const stmtUpdateCertificate = db.prepare(`
  UPDATE database_targets SET
    certificate_ciphertext = @certificate_ciphertext,
    certificate_iv = @certificate_iv,
    certificate_tag = @certificate_tag,
    certificate_uploaded_at = @now,
    updated_at = @now
  WHERE id = @id
`);
const stmtInsertRequest = db.prepare(`
  INSERT INTO database_certificate_requests (id, target_id, user_id, token_hash, expires_at, created_at)
  VALUES (@id, @target_id, @user_id, @token_hash, @expires_at, @created_at)
`);
const stmtGetRequest = db.prepare(`
  SELECT * FROM database_certificate_requests
  WHERE user_id = ? AND expires_at > ?
  ORDER BY created_at DESC LIMIT 1
`);
const stmtDeleteRequestsForTarget = db.prepare('DELETE FROM database_certificate_requests WHERE target_id = ?');
const stmtDeleteRequest = db.prepare('DELETE FROM database_certificate_requests WHERE id = ? AND user_id = ?');
const stmtDeleteUserRequests = db.prepare('DELETE FROM database_certificate_requests WHERE user_id = ?');
const stmtDeleteExpired = db.prepare('DELETE FROM database_certificate_requests WHERE expires_at <= ?');

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function publicRow(row) {
  return {
    id: row.id,
    name: row.name,
    engine: row.engine,
    sslEnabled: Boolean(row.ssl_enabled),
    hasCertificate: Boolean(row.certificate_ciphertext),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    certificateUploadedAt: row.certificate_uploaded_at ?? null,
  };
}

export function listDatabaseTargets() {
  try {
    return stmtList.all().map(publicRow);
  } catch (err) {
    logError('DatabaseStore.list', new Error('Unable to list database targets.'));
    return [];
  }
}

export function getDatabaseTarget(id) {
  try {
    const row = stmtGet.get(id);
    return row ? publicRow(row) : null;
  } catch {
    return null;
  }
}

export function getDatabaseSecretBundle(id) {
  const row = stmtGet.get(id);
  if (!row) return null;
  return {
    ...publicRow(row),
    connectionString: decryptSecret({
      ciphertext: row.connection_ciphertext,
      iv: row.connection_iv,
      tag: row.connection_tag,
    }),
    certificate: row.certificate_ciphertext
      ? decryptSecret({
        ciphertext: row.certificate_ciphertext,
        iv: row.certificate_iv,
        tag: row.certificate_tag,
      })
      : null,
  };
}

export function saveDatabaseTarget({ id, name, engine, connectionString, sslEnabled }) {
  const encrypted = encryptSecret(connectionString);
  try {
    stmtInsert.run({
      id,
      name,
      engine,
      connection_ciphertext: encrypted.ciphertext,
      connection_iv: encrypted.iv,
      connection_tag: encrypted.tag,
      ssl_enabled: sslEnabled ? 1 : 0,
      now: now(),
    });
  } catch (err) {
    logError('DatabaseStore.save', new Error('Unable to save database target.'));
    throw new Error('Database target could not be saved.');
  }
}

export function updateDatabaseCertificate(id, certificate) {
  const encrypted = encryptSecret(certificate);
  const result = stmtUpdateCertificate.run({
    id,
    certificate_ciphertext: encrypted.ciphertext,
    certificate_iv: encrypted.iv,
    certificate_tag: encrypted.tag,
    now: now(),
  });
  if (result.changes !== 1) throw new Error('Database target no longer exists.');
}

export function deleteDatabaseTarget(id) {
  const transaction = db.transaction(() => {
    stmtDeleteRequestsForTarget.run(id);
    return stmtDelete.run(id).changes;
  });
  return transaction() > 0;
}

export function createCertificateRequest({ targetId, userId, expiresAt }) {
  const id = `database_cert_${randomUUID()}`;
  stmtDeleteExpired.run(now());
  stmtDeleteUserRequests.run(userId);
  stmtInsertRequest.run({
    id,
    target_id: targetId,
    user_id: userId,
    token_hash: hashToken(id),
    expires_at: expiresAt,
    created_at: now(),
  });
  return { id };
}

export function deleteCertificateRequest(id, userId) {
  return stmtDeleteRequest.run(id, userId).changes > 0;
}

export function getActiveCertificateRequest(userId) {
  stmtDeleteExpired.run(now());
  return stmtGetRequest.get(userId, now()) ?? null;
}

export function consumeCertificateRequest(id, userId) {
  const request = db.prepare('SELECT * FROM database_certificate_requests WHERE id = ? AND user_id = ?').get(id, userId);
  if (!request || request.expires_at <= now()) return null;
  stmtDeleteRequest.run(id, userId);
  return request;
}
