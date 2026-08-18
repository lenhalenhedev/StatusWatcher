import * as status from './status.js';
import * as uptime from './uptime.js';
import * as list from './list.js';
import * as history from './history.js';
import * as recheck from './recheck.js';
import * as mute from './mute.js';
import * as unmute from './unmute.js';
import * as subscribe from './subscribe.js';
import * as resendEmbed from './resendEmbed.js';
import * as fetchBot from './fetchBot.js';

/**
 * Every slash command module. Each exports `data` (a SlashCommandBuilder) and
 * `execute(interaction)`, and may optionally export `autocomplete(interaction)`.
 */
export const commandModules = [
  status,
  uptime,
  list,
  history,
  recheck,
  mute,
  unmute,
  subscribe,
  resendEmbed,
  fetchBot,
];

/** Lookup map keyed by command name for fast dispatch. */
export const commandMap = new Map(commandModules.map((m) => [m.data.name, m]));
