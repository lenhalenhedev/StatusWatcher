import tls from 'node:tls';
import { lookup as defaultLookup } from 'node:dns/promises';
import { isForbiddenAddress } from '../utils/checkNetworkInput.js';

const DAY_MS = 86_400_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_FIELD_LENGTH = 200;

function safeField(value) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_FIELD_LENGTH);
}

function safeCertificateName(part) {
  if (!part || typeof part !== 'object') return 'Unknown';
  return safeField(part.CN || part.commonName || part.O || part.organization || 'Unknown') || 'Unknown';
}

function safeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function mapSocketError(error) {
  switch (error?.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return safeError('DNS_LOOKUP_FAILED', 'The domain could not be resolved.');
    case 'ECONNREFUSED':
      return safeError('CONNECTION_REFUSED', 'The TLS service refused the connection.');
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return safeError('TIMEOUT', 'The TLS check timed out.');
    case 'CERT_HAS_EXPIRED':
    case 'CERT_NOT_YET_VALID':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return safeError('CERTIFICATE_AUTHORIZATION_FAILED', 'The certificate could not be authorized.');
    default:
      return safeError('TLS_HANDSHAKE_FAILED', 'The TLS handshake failed.');
  }
}

function normalizeCertificate(socket) {
  const certificate = socket.getPeerCertificate?.();
  if (!certificate || typeof certificate !== 'object' || !certificate.valid_to) {
    throw safeError('CERTIFICATE_UNAVAILABLE', 'The server did not provide a usable certificate.');
  }
  const validToMs = Date.parse(certificate.valid_to);
  const validFromMs = certificate.valid_from ? Date.parse(certificate.valid_from) : Number.NaN;
  if (!Number.isFinite(validToMs) || (certificate.valid_from && !Number.isFinite(validFromMs))) {
    throw safeError('CERTIFICATE_INVALID', 'The server certificate has invalid validity dates.');
  }
  const now = Date.now();
  return {
    subject: safeCertificateName(certificate.subject),
    issuer: safeCertificateName(certificate.issuer),
    validFrom: safeField(certificate.valid_from || 'Unknown'),
    validTo: safeField(certificate.valid_to),
    remainingDays: Math.floor((validToMs - now) / DAY_MS),
    expired: validToMs <= now,
    fingerprint256: safeField(certificate.fingerprint256 || 'Unavailable'),
    subjectAltName: safeField(certificate.subjectaltname || 'Unavailable'),
  };
}

export async function checkTlsCertificate(domain, {
  port = 443,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  connect = tls.connect,
  now,
  lookup = defaultLookup,
} = {}) {
  let addresses;
  try {
    const records = await lookup(domain, { all: true, verbatim: true });
    addresses = (Array.isArray(records) ? records : [records]).filter((record) => record?.address);
    if (addresses.length === 0 || addresses.some((record) => isForbiddenAddress(record.address))) {
      throw safeError('FORBIDDEN_ADDRESS', 'Private or reserved addresses are not allowed.');
    }
  } catch (error) {
    if (error?.code === 'FORBIDDEN_ADDRESS') throw error;
    throw mapSocketError(error);
  }
  const selectedAddress = addresses[0];
  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        socket?.removeAllListeners?.();
        socket?.destroy?.();
      } finally {
        callback(value);
      }
    };
    const safeCodes = new Set(['TIMEOUT', 'CERTIFICATE_UNAVAILABLE', 'CERTIFICATE_INVALID', 'CERTIFICATE_AUTHORIZATION_FAILED']);
    const fail = (error) => finish(reject, safeCodes.has(error?.code) ? error : mapSocketError(error));
    const succeed = () => {
      try {
        const certificate = normalizeCertificate({ ...socket, getPeerCertificate: () => socket.getPeerCertificate() });
        const validToMs = Date.parse(certificate.validTo);
        const effectiveNow = Number.isFinite(now) ? now : Date.now();
        certificate.remainingDays = Math.floor((validToMs - effectiveNow) / DAY_MS);
        certificate.expired = validToMs <= effectiveNow;
        finish(resolve, {
          ...certificate,
          authorized: socket.authorized === true,
          authorizationError: socket.authorized === true ? undefined : 'CERTIFICATE_AUTHORIZATION_FAILED',
          protocol: safeField(socket.getProtocol?.() || 'Unknown'),
          cipher: safeField(socket.getCipher?.()?.name || 'Unknown'),
          alpnProtocol: safeField(socket.alpnProtocol || 'None'),
        });
      } catch (error) {
        fail(error);
      }
    };

    try {
      socket = connect({
        host: domain,
        port,
        servername: domain,
        rejectUnauthorized: false,
        lookup: (_hostname, _options, callback) => callback(null, [{ address: selectedAddress.address, family: selectedAddress.family }]),
      });
      socket.once?.('secureConnect', succeed);
      socket.once?.('error', fail);
      socket.once?.('timeout', () => fail(safeError('TIMEOUT', 'The TLS check timed out.')));
      if (typeof socket.setTimeout === 'function') socket.setTimeout(timeoutMs);
      timer = setTimeout(() => fail(safeError('TIMEOUT', 'The TLS check timed out.')), timeoutMs);
    } catch (error) {
      fail(error);
    }
  });
}

export const TLS_CHECK_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
