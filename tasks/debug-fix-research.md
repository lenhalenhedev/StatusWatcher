# Debug-fix official documentation notes

## discord.js 14.22.1 Client

Official API page: https://discord.js.org/docs/packages/discord.js/14.22.1/Client:Class

The Client event list includes `clientReady`. The deprecated `ready(client)` event is documented with the instruction: use `clientReady` instead. The implementation must therefore register the startup handler on `clientReady`, not `ready`.

## discord.js 14.22.1 InteractionReplyOptions

Official API page: https://discord.js.org/docs/packages/discord.js/14.22.1/InteractionReplyOptions:Interface

Interaction reply options expose `flags`; the current API supports `MessageFlags.Ephemeral` for ephemeral replies. Existing use of the boolean `ephemeral` response option must be replaced with `flags: MessageFlags.Ephemeral` for replies, deferred replies, and follow-ups where private visibility is required.

## Debug log findings

`debug.txt` shows the startup event deprecation, the deprecated `ephemeral` option warning, and a runtime listener failure from `src/index.js` calling an undefined `refreshBotRoleFlags` during both `/config` reload and certificate upload reload. The listener failure occurs after SQLite reload and before the status refresh, so role-priority state may remain stale even though the status message update continues.

## Version alignment

The dependency is `discord.js ^14.27.0`. The exact 14.27.0 Client documentation independently lists the deprecated `ready(client)` event and states `Use clientReady instead`.

Source: https://discord.js.org/docs/packages/discord.js/14.27.0/Client:Class
Source: https://discord.js.org/docs/packages/discord.js/14.27.0/InteractionReplyOptions:Interface

## NVM and Node.js 24

The official nvm usage documentation shows `nvm install <version>`, `nvm use <version>`, and `nvm alias default <version>` for installation, activation, and default selection.

Source: https://github.com/nvm-sh/nvm#usage

Node.js official release page lists v24 (Krypton) as LTS. The sandbox was upgraded with NVM to v24.19.0, npm 11.17.0, and the default alias now points to Node 24.

Source: https://nodejs.org/en/about/previous-releases
