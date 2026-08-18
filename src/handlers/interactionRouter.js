import { logError } from '../utils/logger.js';

/**
 * Resolve a command for a component interaction. Commands normally identify
 * themselves through the custom-id prefix, while the fallback scan supports
 * command modules with a different component-id convention.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {Map<string, object>} commandMap
 * @returns {object|undefined}
 */
function resolveComponentHandler(interaction, commandMap) {
  const prefix = interaction.customId?.split(':')[0];
  const prefixedCommand = prefix ? commandMap.get(prefix) : undefined;
  if (prefixedCommand?.handlesInteraction?.(interaction)) return prefixedCommand;

  for (const command of commandMap.values()) {
    if (command?.handlesInteraction?.(interaction)) return command;
  }

  return undefined;
}

/**
 * Create the single interaction boundary used by the Discord client.
 *
 * @param {object} dependencies
 * @param {Map<string, object>} dependencies.commandMap
 * @param {(interaction: import('discord.js').Interaction, deps: object) => Promise<unknown>} dependencies.updateStatusComponent
 * @param {() => Map<string, object>} dependencies.getBotStates
 * @param {() => object} dependencies.getMcState
 * @param {() => Map<string, object>} dependencies.getMcStates
 * @param {(context: string, error: unknown) => unknown} [dependencies.reportError]
 * @returns {(interaction: import('discord.js').Interaction) => Promise<void>}
 */
export function createInteractionHandler({
  commandMap,
  updateStatusComponent,
  getBotStates,
  getMcState,
  getMcStates,
  reportError = logError,
}) {
  return async function handleInteraction(interaction) {
    try {
      if (interaction.isAutocomplete()) {
        const command = commandMap.get(interaction.commandName);
        if (command?.autocomplete) await command.autocomplete(interaction);
        return;
      }

      if (interaction.isModalSubmit?.()) {
        const command = resolveComponentHandler(interaction, commandMap);
        if (command) await command.handleInteraction(interaction);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        const command = resolveComponentHandler(interaction, commandMap);
        if (command) await command.handleInteraction(interaction);
        return;
      }

      if (interaction.isButton()) {
        const command = resolveComponentHandler(interaction, commandMap);
        if (command) {
          await command.handleInteraction(interaction);
        } else {
          await updateStatusComponent(interaction, { getBotStates, getMcStates, getMcState });
        }
        return;
      }

      if (!interaction.isChatInputCommand()) return;
      const command = commandMap.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    } catch (error) {
      void Promise.resolve()
        .then(() => reportError('InteractionRouter.handleInteraction', error))
        .catch(() => undefined);
      if (!interaction.isRepliable?.()) return;

      const payload = {
        content: 'An error occurred while processing the command.',
        ephemeral: true,
      };

      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply(payload);
      } catch {
        // The interaction may have expired or already been acknowledged.
      }
    }
  };
}
