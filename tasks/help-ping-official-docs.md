# Official Discord.js findings for `/help` and `/ping`

The project declares `discord.js` `^14.27.0` and Node.js `>=24.0.0` in `package.json`.

## Sources

1. https://discord.js.org/docs/packages/discord.js/14.27.0/SlashCommandBuilder:Class
2. https://discord.js.org/docs/packages/discord.js/14.27.0/ChatInputCommandInteraction:Class
3. https://discord.js.org/docs/packages/discord.js/14.27.0/Client:Class
4. https://discord.js.org/docs/packages/discord.js/14.27.0/WebSocketManager:Class

## Relevant verified facts

`SlashCommandBuilder` creates API-compatible JSON for slash commands, exposes `setName()`, `setDescription()`, and `toJSON()`. The current API marks `setDefaultPermission()` and `setDMPermission()` as deprecated; the new commands do not need either deprecated method.

`ChatInputCommandInteraction` exposes `reply()`, `editReply()`, `deferReply()`, and `replied`/`deferred` state. The project already uses `MessageFlags` for ephemeral responses, so `/help` can remain public and `/ping` can send a normal content-only reply without an embed.

`Client` exposes `ws`, and `WebSocketManager` documents a readonly numeric `ping` property described as the average ping of all WebSocket shards. `/ping` should read `interaction.client.ws.ping` defensively and present a bounded numeric value; it must not perform an extra API/network request merely to calculate gateway latency.

The project interaction router dispatches chat-input commands through `commandMap`, and dispatches button components to a command module when its `handlesInteraction()` claims the custom-id prefix. Existing status pagination uses strict custom-id parsing and disabled boundary buttons, which is the pattern to reuse for `/help` page buttons.
