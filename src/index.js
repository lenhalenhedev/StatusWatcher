import { ActivityType, Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';
import config from './config.js';
import { logError, logInfo } from './utils/logger.js';
import { printUptimeReport } from './utils/uptimeTracker.js';
import { closeDatabase } from './utils/db.js';
import { initBotMonitor, getBotStates, handleMemberAdd, handleMemberRemove } from './monitors/botMonitor.js';
import { initMcMonitor, checkMcServer, getMcState } from './monitors/mcMonitor.js';
import { cleanLogChannel } from './handlers/notifier.js';
import { postDailyDigest } from './handlers/digest.js';
import { createCheckRunner } from './core/checkCycle.js';
import { registerManualCheck } from './core/monitorController.js';
import { startHealthServer } from './services/healthServer.js';
import { commandMap } from './commands/index.js';
import { refreshStatusMessage, updateStatusComponent } from './services/statusMessage.js';

let isConnected = false;
let checkLoopHandle = null;
let healthServer = null;
let monitoredGuild = null;
const cronJobs = []; // Mảng quản lý các cron job để dọn dẹp khi tắt máy
const bootTime = Date.now();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
  ],
});

client.on('shardDisconnect', () => { isConnected = false; logInfo('Gateway', 'Shard disconnected.'); });
client.on('shardResume', () => { isConnected = true; logInfo('Gateway', 'Shard resumed.'); });

client.on('guildMemberAdd', (member) => handleMemberAdd(member));
client.on('guildMemberRemove', (member) => handleMemberRemove(member));

const runner = createCheckRunner({
  client,
  getGuild: () => monitoredGuild,
  getConnected: () => isConnected,
});
registerManualCheck(runner.run);

function refreshMonitorEmbed() {
  return refreshStatusMessage(client, {
    channelId: config.monitorChannelId,
    getBotStates,
    getMcState,
  }).catch((err) => {
    logError('Index.refreshMonitorEmbed', err);
    return null;
  });
}

client.once('ready', async () => {
  try {
    isConnected = true;
    logInfo('Index', `Logged in as ${client.user.tag}.`);

    monitoredGuild = await client.guilds.fetch(config.guildId);

    initMcMonitor();
    await initBotMonitor(monitoredGuild);
    await checkMcServer(isConnected);

    await cleanLogChannel(client);
    await refreshMonitorEmbed();

    client.user.setPresence({
      activities: [{ name: 'bot & server uptime', type: ActivityType.Watching }],
      status: 'online',
    });

    checkLoopHandle = setInterval(() => { runner.run(); }, config.checkInterval);

    healthServer = startHealthServer(() => ({
      connected: isConnected,
      uptimeSec: Math.floor((Date.now() - bootTime) / 1_000),
      monitoredBots: getBotStates().size,
      minecraftOnline: !getMcState().isConfirmedDown,
    }));

    // Đẩy các job vào mảng để quản lý dọn dẹp
    cronJobs.push(cron.schedule('0 17 * * *', () => printUptimeReport()));
    cronJobs.push(cron.schedule('*/5 * * * *', () => refreshMonitorEmbed()));
    
    if (cron.validate(config.dailyDigestCron)) {
      cronJobs.push(cron.schedule(config.dailyDigestCron, () => postDailyDigest(client)));
    } else {
      logError('Index.cron', new Error(`Invalid DAILY_DIGEST_CRON: ${config.dailyDigestCron}`));
    }

    logInfo('Index', 'Startup complete. Monitoring is active.');
  } catch (err) {
    logError('Index.ready.FATAL', err);
    // Nếu lỗi ngay lúc khởi động, hủy diệt process luôn chứ đéo để treo máy làm cảnh!
    setTimeout(() => process.exit(1), 1000);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const cmd = commandMap.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const removeBotCommand = commandMap.get('remove-bot');
      if (removeBotCommand?.handlesInteraction?.(interaction)) {
        await removeBotCommand.handleInteraction(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      const removeBotCommand = commandMap.get('remove-bot');
      if (removeBotCommand?.handlesInteraction?.(interaction)) {
        await removeBotCommand.handleInteraction(interaction);
      } else {
        await updateStatusComponent(interaction, {
          getBotStates,
          getMcState,
        });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return;
    await cmd.execute(interaction);
  } catch (err) {
    logError('Index.interactionCreate', err);
    if (interaction.isRepliable?.()) {
      const payload = { content: 'An error occurred while processing the command.', ephemeral: true };
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply(payload);
      } catch {
        // Safe ignore
      }
    }
  }
});

process.on('unhandledRejection', (reason) => logError('process.unhandledRejection', reason));
process.on('uncaughtException', (err) => logError('process.uncaughtException', err));

let isShuttingDown = false;
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logInfo('Index', `Received ${signal}. Shutting down gracefully...`);

  // 1. Dọn sạch đống Timer và Cron Job ngay lập tức
  if (checkLoopHandle) clearInterval(checkLoopHandle);
  cronJobs.forEach(job => job.stop());

  // 2. Đóng đóng kết nối đồng bộ/bất đồng bộ an toàn bằng cách bọc trong try-catch
  try {
    if (healthServer && typeof healthServer.close === 'function') {
      await new Promise((resolve) => healthServer.close(resolve));
      logInfo('Index', 'Health server closed.');
    }
    
    if (typeof closeDatabase === 'function') {
      await closeDatabase();
      logInfo('Index', 'Database connection pool closed.');
    }
  } catch (err) {
    logError('Index.shutdown.error', err);
  }

  // 3. Hủy client discord cuối cùng rồi mới cook tiến trình
  client.destroy();
  logInfo('Index', 'Graceful shutdown complete. Exiting.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(config.token);
