# StatusWatcher `/check-tls` Root-Cause Fix

## Outcome

The `/check-tls` failure was reproduced under Node.js 24 and fixed at its source. The failure was not caused by Discord interaction handling, DNS filtering, or the TLS event listeners. It was caused by an obsolete custom DNS lookup callback result shape passed to `tls.connect()`.

## Root cause

The service previously used the pre-Node-20 form:

```js
callback(null, selectedAddress.address, selectedAddress.family)
```

Node.js 20 and later require the address-list form for this callback:

```js
callback(null, [{ address: selectedAddress.address, family: selectedAddress.family }])
```

The old form was independently reproduced with a minimal Node.js 24 `tls.connect()` script. It produced `ERR_INVALID_IP_ADDRESS` with `Invalid IP address: undefined`, before a successful TLS handshake. The corrected form completed a real TLS handshake under Node.js 24 and emitted `secureConnect` with protocol `TLSv1.3`.

The behavior is documented in the Node.js issue concerning custom DNS lookup failures on Node 20 and later [1]. The implementation continues to resolve addresses first, reject forbidden addresses, and pin the selected public address through the TLS lookup callback. No SSRF control was removed or weakened.

## Diagnostic logging change

`/check-tls` now reports a safe internal category through the project logger whenever the service fails. It logs only an allowlisted uppercase error category such as `TLS_HANDSHAKE_FAILED`, `TIMEOUT`, or `UNKNOWN`. Raw exception messages, endpoints, IP addresses, credentials, certificate contents, and attacker-controlled error-code text are not forwarded to the log. The Discord response remains generic and safe.

## Regression coverage

The TLS service regression test now asserts the Node.js 20+ array callback shape while verifying public-address pinning. Command tests additionally verify that the internal category is logged without raw service error text and that malformed error codes normalize to `UNKNOWN`. Existing DNS behavior was reviewed; `/check-dns` uses `dns2` directly and has no analogous custom `tls.connect()` lookup callback.

## Verification

| Check | Result |
|---|---:|
| Node.js runtime | 24.19.0 via NVM |
| TLS and command syntax checks | Passed |
| Focused TLS/DNS/network/command tests | 33 passed, 0 failed |
| Full test suite | 115 passed, 0 failed |
| Generated-log safety scan | No endpoint, password, secret, token, or test IP matches |
| Runtime dependency audit | 0 vulnerabilities reported |
| ZIP integrity check | Passed |

The packaged handoff archive is `StatusWatcher-check-tls-fix.zip`. It excludes `node_modules`, Git metadata, databases, runtime data, logs, and debug artifacts.

## References

[1]: https://github.com/nodejs/node/issues/55762 "Node.js issue #55762: Custom DNS lookup failing on Node 20+, works on Node 18"

[2]: https://nodejs.org/api/tls.html "Node.js TLS documentation"

[3]: https://nodejs.org/api/net.html "Node.js Net documentation"
