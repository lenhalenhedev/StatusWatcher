const THRESHOLDS = Object.freeze([30, 14, 7, 1]);
const DAY_MS = 24 * 60 * 60 * 1000;

export function forecastCertificateWarnings({ expiresAt, now = Date.now(), notifiedMask = 0 } = {}) {
  const expiry = Number(expiresAt);
  const timestamp = Number(now);
  const mask = Number.isInteger(notifiedMask) && notifiedMask >= 0 ? notifiedMask : 0;
  if (!Number.isInteger(expiry) || !Number.isInteger(timestamp)) return { daysRemaining: null, warnings: [], warningMask: mask };
  const daysRemaining = Math.ceil((expiry - timestamp) / DAY_MS);
  const warnings = [];
  let warningMask = mask;
  for (const thresholdDays of THRESHOLDS) {
    const bit = 1 << THRESHOLDS.indexOf(thresholdDays);
    if (daysRemaining <= thresholdDays && !(mask & bit)) {
      warnings.push({ thresholdDays, daysRemaining });
      warningMask |= bit;
    }
  }
  return { daysRemaining, warnings, warningMask };
}

export function tlsWarningThresholds() {
  return [...THRESHOLDS];
}
