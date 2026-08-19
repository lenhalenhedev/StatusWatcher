# `/check-tls` Failure Research

## Code-path observation

`checkTls.js` catches every service error and converts unknown codes to `The check failed. Review the bot logs for a safe diagnostic category.` It never calls the repository `logError` helper, so no console/error.log output is expected when the service rejects. The router logger cannot run because the command catches the error locally.

## Official Node.js TLS documentation

Source: https://nodejs.org/api/tls.html

`tls.connect()` returns a `TLSSocket`. A successful TLS handshake emits `secureConnect`; connection and handshake failures emit `error`; a timeout emits `timeout`; `getPeerCertificate()` reads peer certificate metadata after connection; `destroy()` terminates the socket. The implementation attaches `secureConnect`, `error`, and `timeout`, which is structurally correct.

The current implementation supplies a custom `lookup` option to `tls.connect`. The code must therefore match Node's `net` lookup callback contract exactly, including callback timing and supported address-family behavior. This is a high-risk area because the custom callback pins a pre-resolved address.

## GitHub issue

Source: https://github.com/nodejs/node/issues/45247

The issue demonstrates that TCP connection establishment and TLS `secureConnect` are distinct stages and that some apparent hangs are event-order or protocol-handshake problems rather than a simple TCP failure. It was closed as not planned, not as a confirmed general Node regression.

## Stack Overflow

Source: https://stackoverflow.com/questions/21166691/node-js-uncaught-error-on-connection-fail-how-to-catch

The accepted guidance is to attach an `error` listener to the `TLSSocket` returned by `tls.connect()` in addition to the `secureConnect` listener. The current code does attach one, so the likely defect is not merely a missing listener; it is more likely an error shape/category not mapped by `mapSocketError`, a custom lookup contract mismatch, an address-family mismatch, or the absence of command-level logging.

## Preliminary conclusion before reproduction

Two separate defects are already established: (1) the command hides all unknown service error categories behind the generic response and does not call `logError`, explaining the missing console output; (2) the actual network root cause still requires deterministic reproduction and inspection of the service's custom lookup, socket options, and error event payload before changing implementation behavior.

## Decisive Node.js 20+ custom lookup finding

Source: https://github.com/nodejs/node/issues/55762

The issue reports that a custom DNS lookup callback changed across Node versions. The documented issue summary states:

- Node <=18: `callback(err, address, family)`
- Node >18: `callback(err, [{ address, family }])`

The current implementation calls `callback(null, selectedAddress.address, selectedAddress.family)`, which is the pre-Node-20 shape. The project runs Node.js 24. This is the leading root cause for the observed generic `/check-tls` failure: Node 24 rejects or misinterprets the custom lookup callback result before the TLS handshake can complete. The command then hides the mapped/unknown failure because it does not log the caught error.

The fix must change the custom lookup callback to the Node 20+ shape, preserve the DNS-rebinding address pinning, and add a Node 24 regression test that asserts the callback receives/returns the address-list form. It must also add command-level safe logging so the actual internal category is visible without leaking raw endpoint or certificate data.

## Local Node.js 24 reproduction

A minimal script using `tls.connect()` with the current callback shape was run under the pinned Node.js 24 runtime:

```js
lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4)
```

Observed output:

```json
{"event":"error","code":"ERR_INVALID_IP_ADDRESS","name":"TypeError","message":"Invalid IP address: undefined"}
```

This reproduces the production failure independently of Discord, the command handler, and the service mocks. It confirms the callback-shape mismatch is causal rather than incidental. The raw diagnostic is retained only in this local research note; production logging must emit only a safe internal category.

The paired post-fix script used the Node.js 20+ callback shape:

```js
lookup: (_hostname, _options, callback) => callback(null, [{ address: '93.184.216.34', family: 4 }])
```

It completed the real TLS handshake under Node.js 24 with:

```json
{"event":"secureConnect","protocol":"TLSv1.3"}
```
