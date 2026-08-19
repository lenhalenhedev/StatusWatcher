import { ActivityType, Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';
import config, { subscribeRuntimeConfig } from './config.js';
import { logError, logInfo } from './utils/logger.js';
import { printUptimeReport } from './utils/uptimeTracker.js';
import { closeDatabase } from './utils/db.js';
import { initBotMonitor, getBotStates, handleMemberAdd, handleMemberRemove, refreshBotRoleFlags } from './monitors/botMonitor.js';
import { initMcMonitor, checkMcServers, getMcStates, getMcState } from './monitors/mcMonitor.js';
import { initDatabaseMonitor, getDatabaseStates, checkDatabaseTargets, closeDatabaseMonitor } from './monitors/databaseMonitor.js';
import { cleanLogChannel } from './handlers/notifier.js';
import { postDailyDigest } from './handlers/digest.js';
import { createCheckRunner } from './core/checkCycle.js';
import { loginWithHandling } from './core/login.js';
import { registerManualCheck } from './core/monitorController.js';
import { startHealthServer } from './services/healthServer.js';
import { commandMap } from './commands/index.js';
import { refreshStatusMessage, updateStatusComponent } from './services/statusMessage.js';
import { runBackgroundTask } from './utils/backgroundTask.js';
import { createInteractionHandler } from './handlers/interactionRouter.js';
import { handleCertificateMessage } from './commands/configCommand.js';

/**
 * @typedef {Object} AppState
 * @property {boolean} isConnected
 * @property {NodeJS.Timeout|null} checkLoopHandle
 * @property {import('http').Server|null} healthServer
 * @property {import('discord.js').Guild|null} monitoredGuild
 */

/** @type {AppState} */
const state = {
  isConnected: false,
  checkLoopHandle: null,
  healthServer: null,
  monitoredGuild: null,
};

/** @type {import('node-cron').ScheduledTask[]} */
const cronJobs = [];
let dailyDigestJob = null;
const bootTime = Date.now();

const SHUTDOWN_TIMEOUT_MS = 5_000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('shardDisconnect', () => {
  state.isConnected = false;
  logInfo('Gateway', 'Shard disconnected.');
});
client.on('shardResume', () => {
  state.isConnected = true;
  logInfo('Gateway', 'Shard resumed.');
});

client.on('guildMemberAdd', (member) => {
  if (handleMemberAdd(member)) void refreshMonitorEmbed();
});
client.on('guildMemberRemove', (member) => {
  if (handleMemberRemove(member)) void refreshMonitorEmbed();
});
client.on('messageCreate', (message) => {
  void handleCertificateMessage(message);
});

const runner = createCheckRunner({
  client,
  getGuild: () => state.monitoredGuild,
  getConnected: () => state.isConnected,
});
registerManualCheck(runner.run);

// ---------------------------------------------------------------------------
// Embed refresh: mutex + trailing-call debounce so overlapping triggers
// (manual command, interval loop, cron) never fire concurrent API calls.
// ---------------------------------------------------------------------------

/** @type {Promise<unknown>|null} */
let refreshInFlight = null;
let refreshQueued = false;

/**
 * Refreshes the monitor status embed. Safe to call concurrently from any
 * number of callers (interval loop, cron job, manual triggers) - calls that
 * arrive while a refresh is already running are coalesced into a single
 * trailing refresh instead of stacking up API requests.
 * @returns {Promise<unknown>}
 */
function refreshMonitorEmbed() {
  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }

  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null;
    if (refreshQueued) {
      refreshQueued = false;
      refreshMonitorEmbed();
    }
  });

  return refreshInFlight;
}

/** @returns {Promise<unknown>} */
function doRefresh() {
  return refreshStatusMessage(client, {
    channelId: config.monitorChannelId,
    getBotStates,
    getMcStates,
    getMcState,
    getDatabaseStates,
  }).catch((err) => {
    logError('Index.refreshMonitorEmbed', err);
    return null;
  });
}

function restartCheckLoop() {
  if (state.checkLoopHandle) clearInterval(state.checkLoopHandle);
  state.checkLoopHandle = setInterval(() => {
    void runBackgroundTask('Index.checkCycle', () => runner.run());
  }, config.checkInterval);
}

function scheduleDailyDigest() {
  if (dailyDigestJob) dailyDigestJob.stop();
  if (!cron.validate(config.dailyDigestCron)) {
    logError('Index.cron', new Error(`Invalid DAILY_DIGEST_CRON: ${config.dailyDigestCron}`));
    dailyDigestJob = null;
    return;
  }
  dailyDigestJob = cron.schedule(config.dailyDigestCron, () => {
    void runBackgroundTask('Index.dailyDigest', () => postDailyDigest(client));
  });
}

subscribeRuntimeConfig(() => {
  if (!state.isConnected) return;
  restartCheckLoop();
  scheduleDailyDigest();
  initMcMonitor();
  initDatabaseMonitor();
  if (state.monitoredGuild) refreshBotRoleFlags(state.monitoredGuild);
  void refreshMonitorEmbed();
});

// ---------------------------------------------------------------------------
// Startup sequence
// ---------------------------------------------------------------------------

client.once('clientReady', async () => {
  // Set presence immediately - don't let anything below delay this.
  try {
    client.user.setPresence({
      activities: [{ name: 'bot & server uptime', type: ActivityType.Watching }],
      status: 'online',
    });
  } catch (err) {
    logError('Index.clientReady.setPresence', err);
  }

  state.isConnected = true;
  logInfo('Index', `Logged in as ${client.user.tag}.`);

  // Essential setup: without the guild reference nothing else can run.
  try {
    state.monitoredGuild = await client.guilds.fetch(config.guildId);
  } catch (err) {
    logError('Index.clientReady.FATAL', err);
    setTimeout(() => process.exit(1), 1_000);
    return;
  }

  // Each core subsystem is isolated: a failure in one must not prevent the
  // others from starting (graceful degradation).
  if (config.mcEnabled) {
    try {
      initMcMonitor();
      await checkMcServers(state.isConnected);
    } catch (err) {
      logError('Index.clientReady.mcMonitor', err);
    }
  }

  if (config.databaseEnabled) {
    try {
      initDatabaseMonitor();
      await checkDatabaseTargets(state.isConnected);
    } catch (err) {
      logError('Index.clientReady.databaseMonitor', err);
    }
  }

  try {
    await initBotMonitor(state.monitoredGuild);
  } catch (err) {
    logError('Index.clientReady.botMonitor', err);
  }

  try {
    state.healthServer = startHealthServer(() => ({
      connected: state.isConnected,
      uptimeSec: Math.floor((Date.now() - bootTime) / 1_000),
      monitoredBots: getBotStates().size,
      ...(config.mcEnabled ? {
        minecraftOnline: [...getMcStates().values()].some((mcState) => !mcState.isConfirmedDown),
      } : {}),
      ...(config.databaseEnabled ? {
        databasesOnline: [...getDatabaseStates().values()].filter((databaseState) => databaseState.lastHealthyAt).length,
        databasesDown: [...getDatabaseStates().values()].filter((databaseState) => databaseState.isConfirmedDown).length,
      } : {}),
    }));
  } catch (err) {
    logError('Index.clientReady.healthServer', err);
  }

  // Core monitoring loop can start as soon as the subsystems above are up,
  // regardless of whether the non-critical background tasks below succeed.
  restartCheckLoop();

  cronJobs.push(cron.schedule('0 17 * * *', () => {
    void runBackgroundTask('Index.uptimeReport', () => printUptimeReport());
  }));
  cronJobs.push(cron.schedule('*/5 * * * *', () => {
    void runBackgroundTask('Index.refreshMonitorEmbed', () => refreshMonitorEmbed());
  }));

  scheduleDailyDigest();

  logInfo('Index', 'Startup complete. Monitoring is active.');

  // Non-critical background tasks: run after core monitoring is live, and
  // never allow their failure to affect anything above.
  void (async () => {
    try {
      await cleanLogChannel(client);
    } catch (err) {
      logError('Index.clientReady.cleanLogChannel', err);
    }

    try {
      await refreshMonitorEmbed();
    } catch (err) {
      logError('Index.clientReady.initialEmbedRefresh', err);
    }
  })();
});

// ---------------------------------------------------------------------------
// Interaction routing
// ---------------------------------------------------------------------------

const handleInteraction = createInteractionHandler({
  commandMap,
  updateStatusComponent,
  getBotStates,
  getMcStates,
  getMcState,
  getDatabaseStates,
});

client.on('interactionCreate', (interaction) => {
  void handleInteraction(interaction);
});

process.on('unhandledRejection', (reason) => logError('process.unhandledRejection', reason));
process.on('uncaughtException', (err) => logError('process.uncaughtException', err));

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let isShuttingDown = false;

/**
 * Runs the graceful shutdown sequence, bounded by a hard timeout: if
 * connections don't close in time, the process is force-killed rather than
 * hanging forever.
 * @param {string} signal
 * @param {number} [exitCode=0]
 */
async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logInfo('Index', `Received ${signal}. Shutting down gracefully...`);

  const hardTimeout = setTimeout(() => {
    logError('Index.shutdown', new Error(`Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`));
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  hardTimeout.unref?.();

  try {
    // 1. Stop timers and cron jobs immediately - no new work should start.
    if (state.checkLoopHandle) clearInterval(state.checkLoopHandle);
    cronJobs.forEach((job) => job.stop());
    if (dailyDigestJob) dailyDigestJob.stop();

    // 2. Close connections, each isolated so one failure doesn't block others.
    try {
      if (state.healthServer && typeof state.healthServer.close === 'function') {
        await new Promise((resolve) => state.healthServer.close(resolve));
        logInfo('Index', 'Health server closed.');
      }
    } catch (err) {
      logError('Index.shutdown.healthServer', err);
    }

    try {
      await closeDatabaseMonitor();
    } catch (err) {
      logError('Index.shutdown.databaseMonitor', err);
    }

    try {
      if (typeof closeDatabase === 'function') {
        await closeDatabase();
        logInfo('Index', 'Database connection pool closed.');
      }
    } catch (err) {
      logError('Index.shutdown.database', err);
    }

    // 3. Destroy the Discord client last, and actually await it.
    try {
      await client.destroy();
      logInfo('Index', 'Discord client destroyed.');
    } catch (err) {
      logError('Index.shutdown.clientDestroy', err);
    }

    logInfo('Index', 'Graceful shutdown complete. Exiting.');
    clearTimeout(hardTimeout);
    process.exit(exitCode);
  } catch (err) {
    logError('Index.shutdown.error', err);
    clearTimeout(hardTimeout);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

void loginWithHandling(client, config.token, (error) => {
  state.isConnected = false;
  logError('Index.login', error);
  void shutdown('LOGIN_FAILURE', 1);
});
