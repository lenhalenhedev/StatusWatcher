import { buildStatusEmbed } from '../handlers/embedBuilder.js';
import {
  buildStatusComponents,
  getStatusPageCount,
  parseStatusComponentId,
} from '../handlers/statusPagination.js';
import { getTrackedMessageId, saveTrackedMessageId, clearTrackedMessageId } from '../store/monitorMessageStore.js';
import { logInfo } from '../utils/logger.js';

let currentMonitorPage = 0;
let operationQueue = Promise.resolve();

function enqueue(operation) {
  const next = operationQueue.then(operation, operation);
  operationQueue = next.catch(() => undefined);
  return next;
}

function buildStatusPayload(botStates, mcStates, databaseStates, page) {
  const totalPages = getStatusPageCount(botStates);
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  return {
    embeds: [buildStatusEmbed(botStates, mcStates, currentPage, databaseStates)],
    components: buildStatusComponents(currentPage, totalPages),
  };
}

async function fetchMonitorChannel(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId);
  return channel?.isTextBased() ? channel : null;
}

async function fetchTrackedMessage(channel, channelId) {
  const messageId = getTrackedMessageId(channelId);
  if (!messageId) return null;

  try {
    return await channel.messages.fetch(messageId);
  } catch {
    clearTrackedMessageId(channelId);
    return null;
  }
}

export function refreshStatusMessage(client, { channelId, getBotStates, getMcStates, getMcState, getDatabaseStates, forceNew = false }) {
  return enqueue(async () => {
    const channel = await fetchMonitorChannel(client, channelId);
    if (!channel) return null;

    const mcStates = getMcStates ? getMcStates() : getMcState?.();
    const databaseStates = getDatabaseStates ? getDatabaseStates() : null;
    const payload = buildStatusPayload(getBotStates(), mcStates, databaseStates, forceNew ? 0 : currentMonitorPage);
    let message = forceNew ? null : await fetchTrackedMessage(channel, channelId);

    if (forceNew) {
      const previousMessage = await fetchTrackedMessage(channel, channelId);
      if (previousMessage) await previousMessage.delete().catch(() => undefined);
      clearTrackedMessageId(channelId);
    }

    if (message) {
      await message.edit(payload);
      logInfo('StatusMessage', `Updated tracked status message ${message.id}.`);
      return message;
    }

    message = await channel.send(payload);
    saveTrackedMessageId(channelId, message.id);
    logInfo('StatusMessage', `Created tracked status message ${message.id}.`);
    return message;
  });
}

export function updateStatusComponent(interaction, { getBotStates, getMcStates, getMcState, getDatabaseStates }) {
  return enqueue(async () => {
    const parsed = parseStatusComponentId(interaction.customId);
    if (!parsed) {
      await interaction.reply({ content: 'error: This status control is no longer active.', ephemeral: true });
      return true;
    }

    const totalPages = getStatusPageCount(getBotStates());
    const currentPage = Math.min(Math.max(parsed.page, 0), totalPages - 1);
    let nextPage = currentPage;

    if (parsed.action === 'prev') nextPage -= 1;
    if (parsed.action === 'next') nextPage += 1;

    if (parsed.action === 'page') {
      await interaction.reply({ content: 'error: Page indicator is disabled', ephemeral: true });
      return true;
    }
    if (nextPage < 0) {
      await interaction.reply({ content: 'error: No previous page exists', ephemeral: true });
      return true;
    }
    if (nextPage >= totalPages) {
      await interaction.reply({ content: 'error: No Next page exists', ephemeral: true });
      return true;
    }

    currentMonitorPage = nextPage;
    const mcStates = getMcStates ? getMcStates() : getMcState?.();
    const databaseStates = getDatabaseStates ? getDatabaseStates() : null;
    await interaction.update(buildStatusPayload(getBotStates(), mcStates, databaseStates, nextPage));
    return true;
  });
}

export function getStatusMessagePayload(botStates, mcState, page = 0, databaseStates = null) {
  return buildStatusPayload(botStates, mcState, databaseStates, page);
}

export function resetStatusPage() {
  currentMonitorPage = 0;
}

