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
import * as configCommand from './configCommand.js';
import * as checkTls from './checkTls.js';
import * as checkDns from './checkDns.js';
import * as whois from './whois.js';
import * as acknowledge from './acknowledge.js';
import * as resolveIncident from './resolveIncident.js';
import * as reliability from './reliability.js';
import * as dependency from './dependency.js';
import * as dryRun from './dryRun.js';
import * as diagnose from './diagnose.js';
import * as slo from './slo.js';
import * as audit from './audit.js';
import * as ownership from './ownership.js';
import * as help from './help.js';
import * as ping from './ping.js';

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
  configCommand,
  checkTls,
  checkDns,
  whois,
  acknowledge,
  resolveIncident,
  reliability,
  dependency,
  dryRun,
  diagnose,
  slo,
  audit,
  ownership,
  help,
  ping,
];

help.setCommandModules(commandModules);

/** Lookup map keyed by command name for fast dispatch. */
export const commandMap = new Map(commandModules.map((m) => [m.data.name, m]));
