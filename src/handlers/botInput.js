const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const BOT_MENTION_PATTERN = /^<@!?([^>]+)>$/;

export function parseBotInput(input) {
  const tokens = String(input ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  const seenIds = new Set();
  const validIds = [];
  const invalidTokens = [];
  const duplicateTokens = [];

  for (const token of tokens) {
    const mentionMatch = token.match(BOT_MENTION_PATTERN);
    const id = mentionMatch ? mentionMatch[1] : token;

    if (!DISCORD_ID_PATTERN.test(id)) {
      invalidTokens.push(token);
      continue;
    }
    if (seenIds.has(id)) {
      duplicateTokens.push(token);
      continue;
    }

    seenIds.add(id);
    validIds.push(id);
  }

  return { validIds, invalidTokens, duplicateTokens };
}

export function formatTargetLabel(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || member?.id;
}
