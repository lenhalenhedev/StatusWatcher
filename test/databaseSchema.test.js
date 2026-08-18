import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDatabaseError,
  parseBoolean,
  parseDatabaseConnectionString,
  parseDatabaseName,
  parseDatabaseSsl,
  redactDatabaseError,
  sanitizeDatabaseUriForDriver,
} from '../src/config/databaseSchema.js';

test('detects all supported database URI schemes', () => {
  assert.equal(parseDatabaseConnectionString('postgres://user:pass@example.com:5432/app').engine, 'postgres');
  assert.equal(parseDatabaseConnectionString('postgresql://user:pass@example.com/app').engine, 'postgres');
  assert.equal(parseDatabaseConnectionString('mysql://user:pass@example.com:3306/app').engine, 'mysql');
  assert.equal(parseDatabaseConnectionString('redis://:pass@example.com:6379/0').engine, 'redis');
  assert.equal(parseDatabaseConnectionString('rediss://:pass@example.com:6380/0').engine, 'redis');
  assert.equal(parseDatabaseConnectionString('mongodb://user:pass@example.com:27017/app').engine, 'mongodb');
  assert.equal(parseDatabaseConnectionString('mongodb+srv://user:pass@example.com/app').engine, 'mongodb');
});

test('rejects unsupported schemes, malformed strings, fragments and invalid ports', () => {
  assert.throws(() => parseDatabaseConnectionString('http://example.com')); 
  assert.throws(() => parseDatabaseConnectionString('postgres://example.com:0/app'));
  assert.throws(() => parseDatabaseConnectionString('postgres://example.com:65536/app'));
  assert.throws(() => parseDatabaseConnectionString('postgres://example.com/app#secret'));
  assert.throws(() => parseDatabaseConnectionString('not a URI'));
  assert.throws(() => parseDatabaseConnectionString('mongodb:///db'));
});

test('validates names and strict boolean SSL input', () => {
  assert.equal(parseDatabaseName('Production DB'), 'Production DB');
  assert.throws(() => parseDatabaseName(''));
  assert.throws(() => parseDatabaseName('x'.repeat(101)));
  assert.equal(parseBoolean(' TRUE '), true);
  assert.equal(parseBoolean('false'), false);
  assert.equal(parseDatabaseSsl(''), false);
  assert.throws(() => parseDatabaseSsl('yes'));
});

test('strips driver-controlled TLS override query parameters', () => {
  const postgres = sanitizeDatabaseUriForDriver('postgres://u:p@example.com/app?sslmode=disable&sslrootcert=/tmp/evil.pem&keepalives=0&connect_timeout=1', 'postgres');
  assert.equal(new URL(postgres).searchParams.has('sslmode'), false);
  assert.equal(new URL(postgres).searchParams.has('sslrootcert'), false);
  assert.equal(new URL(postgres).searchParams.has('keepalives'), false);
  assert.equal(new URL(postgres).searchParams.has('connect_timeout'), false);
  const mongo = sanitizeDatabaseUriForDriver('mongodb://u:p@example.com/app?tls=false&tlsAllowInvalidCertificates=true', 'mongodb');
  assert.equal(new URL(mongo).searchParams.has('tls'), false);
  assert.equal(new URL(mongo).searchParams.has('tlsAllowInvalidCertificates'), false);
  assert.equal(new URL(mongo).searchParams.has('serverSelectionTimeoutMS'), false);
});

test('redacts DSNs, credentials, endpoints, paths and newlines from driver errors', () => {
  const raw = 'connect postgres://alice:secret@example.internal:5432/app failed at /srv/cert.pem password=secret 10.20.30.40:5432\nsecond line';
  const safe = redactDatabaseError(raw);
  assert.equal(safe.includes('secret'), false);
  assert.equal(safe.includes('alice'), false);
  assert.equal(safe.includes('example.internal'), false);
  assert.equal(safe.includes('10.20.30.40'), false);
  assert.equal(safe.includes('/srv/cert.pem'), false);
  assert.equal(safe.includes('\n'), false);
});

test('classifies failures without exposing raw connection details', () => {
  assert.equal(classifyDatabaseError(new Error('ECONNREFUSED 10.0.0.1:5432')), 'connection_failed');
  assert.equal(classifyDatabaseError(new Error('password authentication failed')), 'authentication_failed');
  assert.equal(classifyDatabaseError(new Error('socket timeout')), 'timeout');
});
