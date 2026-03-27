import { Events, type Message } from 'discord.js';
import { ActivityManager } from '@share/modules/activity/activity.manager';
import { logError } from '@share/core/functions/logSave.function';
// TODO Написать нормальный креатер для НОН-слеш команд (префикс-команд)
export default {
  name: Events.MessageCreate,
  once: false,

  async execute(message: Message): Promise<void> {
    if (!message.author) return;
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.partial) {
      try {
        await message.fetch();
      } catch {
        return;
      }
    }

    // 📊 СИСТЕМА АКТИВНОСТИ
    try {
      const manager = ActivityManager.getInstance();
      manager.handleMessage(message);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Не инициализирован')) {
        return;
      }
      logError('MessageCreate', `Ошибка: ${err}`);
    }
  },
};