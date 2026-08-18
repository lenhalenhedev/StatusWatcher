import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { listTargets, getDailyUptime } from '../utils/uptimeTracker.js';
import { getBotStates } from '../monitors/botMonitor.js';
import { getMcStates } from '../monitors/mcMonitor.js';
import { isMuted } from '../store/muteStore.js';
import config from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('list')
  .setDescription('List all monitored targets and their current status');

/**
 * Resolve the live DOWN/UP status of a target from runtime state.
 * @returns {boolean|null} true=down, false=up, null=unknown
 */
function resolveLiveDown(target, botStates, mcStates) {
  if (target.type === 'minecraft') return mcStates.get(target.id)?.isConfirmedDown ?? null;
  const state = botStates.get(target.id);
  return state ? state.isConfirmedDown : null;
}

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
export async function execute(interaction) {
  const targets = listTargets().filter((target) => config.mcEnabled || target.type !== 'minecraft');
  if (targets.length === 0) {
    await interaction.reply({ content: 'No targets are being monitored yet.', ephemeral: true });
    return;
  }

  const botStates = getBotStates();
  const mcStates = getMcStates();

  const lines = targets.map((t) => {
    const down = resolveLiveDown(t, botStates, mcStates);
    const dot = t.status === 'archived' ? '⚪' : down === true ? '🔴' : down === false ? '🟢' : '⚫';
    const star = t.has_important_role ? ' ⭐' : '';
    const muted = isMuted(t.id) ? ' 🔇' : '';
    return `${dot} **${t.name}**${star}${muted} — 24h \`${getDailyUptime(t.id)}%\``;
  });

  const embed = new EmbedBuilder()
    .setTitle('📋 Monitored Targets')
    .setColor(0x5865F2)
    .setDescription(lines.join('\n').substring(0, 4096))
    .setFooter({ text: '🟢 up · 🔴 down · ⚫ unknown · ⚪ archived · ⭐ important · 🔇 muted' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
