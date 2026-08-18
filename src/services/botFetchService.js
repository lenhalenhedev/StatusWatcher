import config from '../config.js';
import { logError, logInfo } from '../utils/logger.js';
import { getBotStates, hydrateBotState, removeBotState } from '../monitors/botMonitor.js';
import { deleteTarget, listTargets, registerTarget } from '../utils/uptimeTracker.js';

export const BOT_FETCH_BATCH_SIZE = 10;
export const BOT_FETCH_DELAY_MS = 10_000;
const MEMBER_PAGE_SIZE = 1_000;

const guildMembersRoute = guildId => `/guilds/${guildId}/members`;
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizePage(page) {
  if (!page) return [];
  if (Array.isArray(page)) return page;
  if (typeof page.values === 'function') return [...page.values()];
  return [];
}

function memberId(rawMember) {
  return rawMember?.user?.id ?? rawMember?.id ?? null;
}

function isBotRecord(rawMember) {
  return Boolean(rawMember?.user?.bot) && memberId(rawMember) !== config.clientId;
}

function toGuildMember(guild, rawMember) {
  const id = memberId(rawMember);
  const cached = guild.members?.cache?.get?.(id);
  if (cached) return cached;

  const roleIds = new Set(rawMember.roles ?? []);
  return {
    id,
    user: rawMember.user,
    displayName: rawMember.nick || rawMember.user?.globalName || rawMember.user?.username || id,
    presence: rawMember.presence ?? null,
    roles: { cache: { has: roleId => roleIds.has(roleId) } },
    guild,
  };
}

async function fetchMemberPage(guild, after) {
  // discord.js exposes the supported paginated member-list endpoint publicly.
  // Prefer it over a hand-built REST request so `after` and `limit` are encoded
  // exactly as Discord expects.
  if (typeof guild.members?.list === 'function') {
    return guild.members.list({
      limit: MEMBER_PAGE_SIZE,
      ...(after ? { after } : {}),
    });
  }

  // Keep a small test/compatibility fallback for guild-like objects that only
  // expose the REST client. REST requires URLSearchParams for query values.
  const query = new URLSearchParams({ limit: String(MEMBER_PAGE_SIZE) });
  if (after) query.set('after', after);
  return guild.client.rest.get(guildMembersRoute(guild.id), { query });
}

async function fetchMemberObjects(guild, rawBatch) {
  const ids = rawBatch.map(memberId).filter(Boolean);
  if (!ids.length) return [];

  // Hydrate presence through the Gateway for only the 10 bot IDs in this
  // batch. The REST list endpoint supplies roles and bot identity, while the
  // Gateway member fetch supplies the current presence snapshot.
  if (typeof guild.members?.fetch === 'function') {
    try {
      const fetched = await guild.members.fetch({ user: ids, withPresences: true, force: true });
      const collection = fetched?.values ? [...fetched.values()] : [fetched];
      const byId = new Map(collection.filter(Boolean).map(member => [member.id, member]));
      return rawBatch.map(raw => byId.get(memberId(raw)) ?? toGuildMember(guild, raw));
    } catch (err) {
      logError('BotFetchService.fetchPresenceBatch', err);
    }
  }

  return rawBatch.map(raw => toGuildMember(guild, raw));
}

/**
 * Fetch all guild members through REST pagination, process only Discord bots in
 * batches of ten, and wait ten seconds between non-final batches.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} [options]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {(count: number) => void|Promise<void>} [options.onProgress]
 * @param {(guild: object, after?: string) => Promise<Array<object>>} [options.fetchPage]
 * @returns {Promise<{ fetchedBots: number, batches: number }>}
 */
export async function fetchBotsInBatches(guild, {
  sleep = defaultSleep,
  onProgress = () => {},
  fetchPage = fetchMemberPage,
} = {}) {
  let after;
  let fetchedBots = 0;
  let batches = 0;
  const seenBotIds = new Set();
  const fetchedMembersById = new Map();

  while (true) {
    const page = normalizePage(await fetchPage(guild, after));
    if (page.length === 0) break;

    let batch = [];
    for (let index = 0; index < page.length; index += 1) {
      const rawMember = page[index];
      const id = memberId(rawMember);
      if (!isBotRecord(rawMember) || !id || seenBotIds.has(id)) continue;
      seenBotIds.add(id);
      batch.push(rawMember);

      if (batch.length !== BOT_FETCH_BATCH_SIZE) continue;

      const members = await fetchMemberObjects(guild, batch);
      for (const member of members) fetchedMembersById.set(member.id, member);
      fetchedBots += batch.length;
      batches += 1;
      await onProgress(fetchedBots);
      logInfo('BotFetchService', `Fetched ${fetchedBots} bot(s).`);
      batch = [];

      const hasMoreInPage = index < page.length - 1;
      const pageMayHaveMore = page.length === MEMBER_PAGE_SIZE;
      if (hasMoreInPage || pageMayHaveMore) await sleep(BOT_FETCH_DELAY_MS);
    }

    if (batch.length > 0) {
      const members = await fetchMemberObjects(guild, batch);
      for (const member of members) fetchedMembersById.set(member.id, member);
      fetchedBots += batch.length;
      batches += 1;
      await onProgress(fetchedBots);
      logInfo('BotFetchService', `Fetched ${fetchedBots} bot(s).`);
    }

    const lastId = memberId(page[page.length - 1]);
    if (page.length < MEMBER_PAGE_SIZE || !lastId || lastId === after) break;
    after = lastId;
  }

  // Commit only after every REST page has completed successfully. This makes
  // the command safe to retry if Discord returns a transient page error.
  const storedBotTargets = listTargets({ activeOnly: true }).filter(target => target.type === 'bot');
  for (const target of storedBotTargets) {
    if (!fetchedMembersById.has(target.id)) {
      deleteTarget(target.id);
      removeBotState(target.id);
    }
  }

  for (const member of fetchedMembersById.values()) {
    registerTarget(member.id, member.user?.username || member.id, {
      type: 'bot',
      hasImportantRole: member.roles?.cache?.has?.(config.importantRoleId),
    });
  }

  // Read the committed active rows back from SQLite, then hydrate runtime RAM.
  const committedTargets = listTargets({ activeOnly: true }).filter(target => target.type === 'bot');
  for (const target of committedTargets) {
    const member = fetchedMembersById.get(target.id) ?? guild.members?.cache?.get?.(target.id);
    if (member) hydrateBotState(member);
  }

  return { fetchedBots, batches, monitoredBots: getBotStates().size };
}
