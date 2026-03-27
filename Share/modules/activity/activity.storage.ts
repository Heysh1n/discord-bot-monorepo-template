import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ActivityDatabase, UserActivity } from './activity.types';

export class ActivityStorage {
  private data: ActivityDatabase;
  private filePath: string;
  private dirty = false;

  /**
   * @param dataDir — путь к папке activity (getBotPaths().activity)
   */
  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.filePath = join(dataDir, 'activity.json');
    this.data = this.load();
  }
  // ─── Загрузка / сохранение ──────────────────────────────

  private load(): ActivityDatabase {
    if (!existsSync(this.filePath)) {
      return { version: 1, lastSave: Date.now(), users: {} };
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as ActivityDatabase;
    } catch (e) {
      console.warn('[ActivityStorage] Повреждённый файл, создаю новый:', e);
      return { version: 1, lastSave: Date.now(), users: {} };
    }
  }

  save(): void {
    if (!this.dirty) return;
    this.data.lastSave = Date.now();
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    this.dirty = false;
  }

  /** Принудительное сохранение (для shutdown) */
  forceSave(): void {
    this.dirty = true;
    this.save();
  }

  // ─── Получение / создание записи пользователя ──────────

  private makeKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  getUser(guildId: string, userId: string): UserActivity {
    const key = this.makeKey(guildId, userId);

    if (!this.data.users[key]) {
      const today = new Date().toISOString().slice(0, 10);
      this.data.users[key] = {
        discordId: userId,
        guildId: guildId,
        voice: {
          totalSeconds: 0,
          sessionCount: 0,
          lastJoinAt:   null,
          lastLeaveAt:  null,
          perChannel:   {},
        },
        messages: {
          total:      0,
          lastAt:     null,
          perChannel: {},
        },
        daily: {
          date:         today,
          voiceSeconds: 0,
          messages:     0,
        },
      };
      this.dirty = true;
    }

    // Сброс daily если день сменился
    const today = new Date().toISOString().slice(0, 10);
    const user = this.data.users[key];
    if (user.daily.date !== today) {
      user.daily = { date: today, voiceSeconds: 0, messages: 0 };
      this.dirty = true;
    }

    return user;
  }

  // ─── Обновления ─────────────────────────────────────────

  addVoiceTime(guildId: string, userId: string, channelId: string, seconds: number): UserActivity {
    const user = this.getUser(guildId, userId);
    user.voice.totalSeconds += seconds;
    user.voice.sessionCount += 1;
    user.voice.lastLeaveAt = Date.now();
    user.voice.perChannel[channelId] = (user.voice.perChannel[channelId] || 0) + seconds;
    user.daily.voiceSeconds += seconds;
    this.dirty = true;
    return user;
  }

  addMessage(guildId: string, userId: string, channelId: string): UserActivity {
    const user = this.getUser(guildId, userId);
    user.messages.total += 1;
    user.messages.lastAt = Date.now();
    user.messages.perChannel[channelId] = (user.messages.perChannel[channelId] || 0) + 1;
    user.daily.messages += 1;
    this.dirty = true;
    return user;
  }

  // ─── Запросы ────────────────────────────────────────────

  /** Топ по войсу за всё время */
  getTopVoice(guildId: string, limit = 10): UserActivity[] {
    return Object.values(this.data.users)
      .filter(u => u.guildId === guildId)
      .sort((a, b) => b.voice.totalSeconds - a.voice.totalSeconds)
      .slice(0, limit);
  }

  /** Топ по сообщениям за всё время */
  getTopMessages(guildId: string, limit = 10): UserActivity[] {
    return Object.values(this.data.users)
      .filter(u => u.guildId === guildId)
      .sort((a, b) => b.messages.total - a.messages.total)
      .slice(0, limit);
  }

  /** Топ по дневной активности */
  getTopDaily(guildId: string, limit = 10, type: 'voice' | 'messages' = 'voice'): UserActivity[] {
    const today = new Date().toISOString().slice(0, 10);
    return Object.values(this.data.users)
      .filter(u => u.guildId === guildId && u.daily.date === today)
      .sort((a, b) => {
        if (type === 'voice') return b.daily.voiceSeconds - a.daily.voiceSeconds;
        return b.daily.messages - a.daily.messages;
      })
      .slice(0, limit);
  }

  /** Все записи сервера */
  getGuildUsers(guildId: string): UserActivity[] {
    return Object.values(this.data.users).filter(u => u.guildId === guildId);
  }
}