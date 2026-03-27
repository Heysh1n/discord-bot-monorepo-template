import dotenv from 'dotenv';
dotenv.config();
import '@share/base';
import { getToken, initBotPaths } from '@share/constants.js';
const paths = initBotPaths('_Template'); // CHANGE US
export const token = getToken("TOKEN") // CHANGE US
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import moment from 'moment-timezone';

import {
  getConfigManagerInstance,
  logsSettings,
  getErrorChannelId,
  getIgnorePatterns,
  ErrorHandlerCfg,
} from './config/config';
import { initLogSave, logError, logInfo } from '@share/core/functions/logSave.function';
import { setupGlobalErrorHandler } from '@share/core/functions/antiError.function';
import EventCollector from './events/collectors/event.collector';

(async () => {
  try {
    const status = getConfigManagerInstance().getStatus();
    logInfo('STATUS', `Статус бота ${status}`);

    await initLogSave(logsSettings);
    moment.tz.setDefault(logsSettings.timezone);

    setupGlobalErrorHandler(() => ({
      ...ErrorHandlerCfg,
      botName: logsSettings.botName,
      errorChannelId: getErrorChannelId(),
      ignorePatterns: getIgnorePatterns(),
    }));
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });

    client.commands = new Collection();
    client.components = new Collection();
    client.subscribes = new Collection();
    client.voiceUsers = new Collection();

    // События
    logInfo('SYSTEM', 'Загрузка событий...');
    const eventCollector = new EventCollector(client);
    await eventCollector.collect();

    // Логин
    await client.login(token);

  } catch (err: any) {
    console.error('💀 КРИТИЧЕСКАЯ ОШИБКА:', err);
    logError('FATAL', `${err.message || err}`);
    process.exit(1);
  }
})();
