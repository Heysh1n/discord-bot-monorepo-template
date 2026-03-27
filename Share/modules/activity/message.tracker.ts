// Share/modules/activity/message.tracker.ts

import type { Message } from 'discord.js';
import type { TrackerConfig } from './activity.types';

export class MessageTracker {
  // Кулдаун: ключ "guildId:userId" → timestamp последнего учтённого сообщения
  private cooldowns = new Map<string, number>();
  private cleanCounter = 0;

  constructor(private config: TrackerConfig) {}

  /**
   * Обрабатывает сообщение.
   * Возвращает результат если сообщение учтено, null если игнорируется.
   */
  processMessage(message: Message): MessageResult | null {
    // ✅ Защита от partial messages — автор может быть undefined
    if (!message.author) {
      return null;
    }

    // Игнорируем ботов
    if (this.config.ignoreBots && message.author.bot) {
      return null;
    }

    // Игнорируем DM
    if (!message.guild) {
      return null;
    }

    // ✅ Дополнительная проверка на system messages
    if (message.system) {
      return null;
    }

    // Игнорируем каналы из списка
    if (this.config.ignoredChannels.includes(message.channelId)) {
      return null;
    }

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const last = this.cooldowns.get(key) ?? 0;

    // Кулдаун
    if (now - last < this.config.messageCooldownMs) {
      return null;
    }

    this.cooldowns.set(key, now);
    this.cleanupCooldowns();

    return {
      userId:    message.author.id,
      guildId:   message.guild.id,
      channelId: message.channelId,
      timestamp: now,
    };
  }

  /** Чистим устаревшие кулдауны каждые ~100 сообщений */
  private cleanupCooldowns(): void {
    if (++this.cleanCounter < 100) return;
    this.cleanCounter = 0;
    const threshold = Date.now() - this.config.messageCooldownMs * 2;
    for (const [key, ts] of this.cooldowns) {
      if (ts < threshold) this.cooldowns.delete(key);
    }
  }
}

export interface MessageResult {
  userId:    string;
  guildId:   string;
  channelId: string;
  timestamp: number;
}