import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { createClient as createRedisClient } from 'redis';
import { MongoClient } from 'mongodb';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import config from '../config.js';
import { logInfo } from '../utils/logger.js';
import { registerTarget, recordDown, recordUp, getOpenSessionStart } from '../utils/uptimeTracker.js';
import { getDatabaseSecretBundle, listDatabaseTargets } from '../store/databaseStore.js';
import { classifyDatabaseError, sanitizeDatabaseUriForDriver } from '../config/databaseSchema.js';
import { createDatabaseState, markOnline, markOffline } from './databaseState.js';
import { recordProbeEvidence } from '../services/probeEvidenceService.js';

const states = new Map();
const CERT_DIR = join(process.cwd(), 'data', '.database-certs');
const PROBE_TIMEOUT_MS = 15_000;

function newState(target) {
  return createDatabaseState(target);
}

function stateFor(target) {
  let state = states.get(target.id);
  if (!state) {
    state = newState(target);
    states.set(target.id, state);
  } else {
    state.name = target.name;
    state.engine = target.engine;
    state.sslEnabled = target.sslEnabled;
    state.hasCertificate = target.hasCertificate;
  }
  return state;
}

function mysqlOptions(connectionString, sslEnabled, certificate) {
  const url = new URL(connectionString);
  const options = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '') || undefined,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    connectTimeout: PROBE_TIMEOUT_MS,
  };
  if (sslEnabled) options.ssl = { rejectUnauthorized: true, ...(certificate ? { ca: certificate } : {}) };
  return options;
}

async function createClient(state) {
  const bundle = getDatabaseSecretBundle(state.id);
  if (!bundle) throw new Error('Database target is unavailable.');
  const certificate = bundle.certificate ? Buffer.from(bundle.certificate, 'base64') : null;

  if (state.engine === 'postgres') {
    const client = new PgClient({
      connectionString: sanitizeDatabaseUriForDriver(bundle.connectionString, 'postgres'),
      ssl: state.sslEnabled ? { rejectUnauthorized: true, ...(certificate ? { ca: certificate.toString('utf8') } : {}) } : false,
      connectionTimeoutMillis: PROBE_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    client.on('error', () => undefined);
    await client.connect();
    state.clientKind = 'postgres';
    return client;
  }

  if (state.engine === 'mysql') {
    const client = await mysql.createConnection(mysqlOptions(bundle.connectionString, state.sslEnabled, certificate));
    client.on('error', () => undefined);
    state.clientKind = 'mysql';
    return client;
  }

  if (state.engine === 'redis') {
    const url = new URL(bundle.connectionString);
    const socket = {
      connectTimeout: PROBE_TIMEOUT_MS,
      reconnectStrategy: false,
      keepAlive: true,
      ...(state.sslEnabled || url.protocol === 'rediss:' ? { tls: true, rejectUnauthorized: true, ...(certificate ? { ca: certificate } : {}) } : {}),
    };
    const client = createRedisClient({ url: sanitizeDatabaseUriForDriver(bundle.connectionString, 'redis'), socket });
    client.on('error', () => undefined);
    await client.connect();
    state.clientKind = 'redis';
    return client;
  }

  if (state.engine === 'mongodb') {
    let certificatePath = null;
    if (certificate) {
      await mkdir(CERT_DIR, { recursive: true, mode: 0o700 });
      certificatePath = join(CERT_DIR, `${state.id}-${randomUUID()}.pem`);
      await writeFile(certificatePath, certificate, { mode: 0o600, flag: 'wx' });
      state.certificatePath = certificatePath;
    }
    const client = new MongoClient(sanitizeDatabaseUriForDriver(bundle.connectionString, 'mongodb'), {
      tls: state.sslEnabled,
      ...(certificatePath ? { tlsCAFile: certificatePath } : {}),
      connectTimeoutMS: PROBE_TIMEOUT_MS,
      serverSelectionTimeoutMS: PROBE_TIMEOUT_MS,
      socketTimeoutMS: PROBE_TIMEOUT_MS,
      maxPoolSize: 1,
      minPoolSize: 0,
    });
    await client.connect();
    state.clientKind = 'mongodb';
    return client;
  }

  throw new Error('Unsupported database engine.');
}

async function closeClient(state) {
  const pending = state.connecting;
  state.connecting = null;
  if (pending) await pending.catch(() => undefined);
  const client = state.client;
  state.client = null;
  if (client) {
    try {
      if (state.clientKind === 'postgres') await client.end();
      else if (state.clientKind === 'mysql') await client.end();
      else if (state.clientKind === 'redis') await client.quit();
      else if (state.clientKind === 'mongodb') await client.close();
    } catch {
      // Closing an already broken network connection is intentionally best effort.
    }
  }
  state.clientKind = null;
  if (state.certificatePath) {
    await unlink(state.certificatePath).catch(() => undefined);
    state.certificatePath = null;
  }
}

async function ensureClient(state) {
  if (state.client) return state.client;
  if (!state.connecting) {
    state.connecting = createClient(state)
      .then((client) => {
        state.client = client;
        return client;
      })
      .finally(() => {
        state.connecting = null;
      });
  }
  return state.connecting;
}

function withProbeTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Database probe timeout.')), PROBE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probe(state) {
  const client = await ensureClient(state);
  if (state.clientKind === 'postgres') {
    await withProbeTimeout(client.query('SELECT 1'));
  } else if (state.clientKind === 'mysql') {
    await withProbeTimeout(client.ping());
  } else if (state.clientKind === 'redis') {
    const response = await withProbeTimeout(client.ping());
    if (response !== 'PONG') throw new Error('Redis PING did not return PONG.');
  } else if (state.clientKind === 'mongodb') {
    await withProbeTimeout(client.db('admin').command({ ping: 1 }));
  } else {
    throw new Error('Database client is not initialized.');
  }
}

function onlineResult(state) {
  const event = markOnline(state, { getOpenSessionStart, recordUp });
  if (event.type === 'UP') logInfo('DatabaseMonitor', `Database target ${state.id} recovered to UP.`);
  return event;
}

function offlineResult(state, error) {
  const wasFirstFailure = state.firstSeenOffline === null;
  const event = markOffline(state, error, {
    confirmDownThresholdMs: config.confirmDownThresholdMs,
    classifyError: classifyDatabaseError,
    getOpenSessionStart,
    recordDown,
  });
  if (wasFirstFailure) logInfo('DatabaseMonitor', `Database target ${state.id} probe failed; confirmation timer started.`);
  if (event.type === 'DOWN') logInfo('DatabaseMonitor', `Database target ${state.id} confirmed DOWN.`);
  return event;
}

export function getDatabaseStates() {
  return states;
}

export function initDatabaseMonitor() {
  const targets = listDatabaseTargets();
  const activeIds = new Set(targets.map((target) => target.id));
  for (const [id, state] of states) {
    if (!activeIds.has(id)) {
      void closeClient(state);
      states.delete(id);
    }
  }
  for (const target of targets) {
    registerTarget(target.id, target.name, { type: 'database' });
    stateFor(target);
  }
}

export async function removeDatabaseState(id) {
  const state = states.get(id);
  if (!state) return false;
  await closeClient(state);
  return states.delete(id);
}

export async function checkDatabaseTargets(isConnected) {
  if (!config.databaseEnabled || !isConnected) return [];
  initDatabaseMonitor();
  const results = await Promise.all(listDatabaseTargets().map(async (target) => {
    const state = stateFor(target);
    const startedAt = Date.now();
    try {
      await probe(state);
      const event = onlineResult(state);
      recordProbeEvidence({
        serviceId: target.id,
        serviceType: 'database',
        observedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        success: true,
        eventType: event.type,
      });
      return { target, state, event };
    } catch (error) {
      await closeClient(state);
      const event = offlineResult(state, error);
      recordProbeEvidence({
        serviceId: target.id,
        serviceType: 'database',
        observedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        success: false,
        eventType: event.type,
        errorCategory: classifyDatabaseError(error),
      });
      return { target, state, event };
    }
  }));
  return results;
}

export async function closeDatabaseMonitor() {
  await Promise.all([...states.values()].map((state) => closeClient(state)));
  states.clear();
}
