import { REST, Routes } from 'discord.js';
import 'dotenv/config';
import { commandModules } from './commands/index.js';
import { logError } from './utils/logger.js';

// Validate required env vars before deploy.
if (!process.env.TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
  console.error('[DEPLOY] Missing TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
const commands = commandModules.map((m) => m.data.toJSON());

try {
  console.log(`[DEPLOY] Registering ${commands.length} slash command(s) to the guild...`);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands },
  );
  console.log('[DEPLOY] Registration complete. Run "npm start" to start the bot.');
} catch (err) {
  await logError('Deploy.registerCommands', err);
  process.exit(1);
}
