import { lookupWhois } from '../src/services/whoisService.js';

try {
  const result = await lookupWhois('example.com', { timeoutMs: 5_000 });
  console.log(JSON.stringify({
    ok: true,
    fields: Object.keys(result),
    fieldCount: Object.keys(result).length,
  }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, category: error?.code || 'UNKNOWN' }));
  process.exitCode = 1;
}
