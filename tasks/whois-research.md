# WHOIS Research Notes

## Package identified

The requested npm package is `whois`, currently published as version `2.16.2` according to the npm package page accessed on 19 August 2026. The npm page identifies it as a Node.js WHOIS client and links its repository to `https://github.com/hjr265/node-whois`, which redirects to the maintained `FurqanSoftware/node-whois` repository.

## Documented API

The package README documents the callback API:

```js
var whois = require('whois');
whois.lookup('google.com', function (err, data) {
  console.log(data);
});
```

It also documents an options object between the address and callback:

```js
{
  server: '',
  follow: 2,
  timeout: 0,
  verbose: false,
  bind: null,
  proxy: { host: '', port: 0, type: 5 }
}
```

The README states that `server` may be a string such as `host:port` or an object with `host` and `port`; an empty server uses the package's `servers.json`; `follow` controls referral following; `timeout` controls the socket timeout; and `verbose` returns an array of responses from all servers. The command will use the package's normal server selection, a bounded timeout, and a bounded referral count. It will not expose proxy or bind controls to Discord users.

## Output and security implications

The documented client returns raw WHOIS text rather than a guaranteed normalized schema. WHOIS responses are registry-controlled untrusted text and may contain arbitrary labels, long lines, PII, contact details, email addresses, phone numbers, or control characters. The implementation therefore needs strict input validation, a request timeout, a maximum output size, line/field normalization, sensitive-field filtering, Discord embed field limits, and generic error responses. Raw WHOIS text must not be logged.

## Sources

1. https://www.npmjs.com/package/whois — package page, version, README, metadata, and license.
2. https://github.com/FurqanSoftware/node-whois — repository README and source listing.
3. https://github.com/hjr265/node-whois — repository URL linked by npm; redirects to the maintained repository.
