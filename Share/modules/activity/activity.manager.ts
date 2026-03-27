
import { EventEmitter } from 'events';
import type { Client, VoiceState, Message } from 'discord.js';
import { ActivityStorage } from './activity.storage';
import { VoiceTracker } from './voice.tracker';
import { MessageTracker } from './message.tracker';
import { logInfo } from '@share/core/functions/logSave.function';
import { ActivityEvents, DEFAULT_CONFIG, type TrackerConfig } from './activity.types';
import { getBotPaths } from "@share/constants.js";


/**
 * ActivityManager — единая точка входа для системы трекинга.
 */
export class ActivityManager extends EventEmitter {
  private static instance: ActivityManager | null = null;

  private storage:        ActivityStorage;
  private voiceTracker:   VoiceTracker;
  private messageTracker: MessageTracker;
  private saveTimer:      ReturnType<typeof setInterval> | null = null;
  private config:         TrackerConfig;

  private constructor(config: Partial<TrackerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // ✅ Определяем путь к activity
    // Если передан dataDir — используем его, иначе берём из BotPaths
    const activityDir = this.config.dataDir && this.config.dataDir !== './activity'
      ? this.config.dataDir
      : getBotPaths().activity;
    
    this.storage        = new ActivityStorage(activityDir);
    this.voiceTracker   = new VoiceTracker(this.config);
    this.messageTracker = new MessageTracker(this.config);
  }

  // ─── Singleton ──────────────────────────────────────────

  static init(config?: Partial<TrackerConfig>): ActivityManager {
    if (!ActivityManager.instance) {
      ActivityManager.instance = new ActivityManager(config);
    }
    return ActivityManager.instance;
  }

  static getInstance(): ActivityManager {
    if (!ActivityManager.instance) {
      throw new Error('[ActivityManager] Не инициализирован! Вызови ActivityManager.init() в ready.');
    }
    return ActivityManager.instance;
  }
  
  static destroy(): void {
  if (ActivityManager.instance) {
    ActivityManager.instance.stop();
    ActivityManager.instance = null;
  }
}
  // ─── Запуск / остановка ─────────────────────────────────

  start(): void {
    // Автосохранение
    this.saveTimer = setInterval(() => {
      this.storage.save();
      this.emit(ActivityEvents.Save, { timestamp: Date.now() });
    }, this.config.saveIntervalMs);

    logInfo("ACTIVITY", `Запущен (сохранение каждые ${this.config.saveIntervalMs / 1000}с)`);
  }

  stop(): void {
    // Завершаем все voice сессии
    const flushed = this.voiceTracker.flushAll();
    for (const result of flushed) {
      this.storage.addVoiceTime(result.guildId, result.userId, result.channelId, result.durationSec);
      this.emit(ActivityEvents.VoiceLeave, result);
    }

    // Останавливаем таймер
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    // Финальное сохранение
    this.storage.forceSave();
    console.log(`[ActivityManager] Остановлен, ${flushed.length} сессий завершено`);
  }

  // ─── Обработчики событий Discord ───────────────────────

  handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
    const result = this.voiceTracker.processUpdate(oldState, newState);
    if (!result) return;

    switch (result.type) {
      case 'join':
        this.storage.getUser(result.guildId, result.userId).voice.lastJoinAt = Date.now();
        this.emit(ActivityEvents.VoiceJoin, result);
        break;

      case 'leave':
        this.storage.addVoiceTime(result.guildId, result.userId, result.channelId, result.durationSec);
        this.emit(ActivityEvents.VoiceLeave, result);
        break;

      case 'switch':
        // Записываем время в старом канале
        this.storage.addVoiceTime(result.guildId, result.userId, result.oldChannelId, result.durationSec);
        this.storage.getUser(result.guildId, result.userId).voice.lastJoinAt = Date.now();
        this.emit(ActivityEvents.VoiceSwitch, result);
        break;
    }
  }

  handleMessage(message: Message): void {
    const result = this.messageTracker.processMessage(message);
    if (!result) return;

    const user = this.storage.addMessage(result.guildId, result.userId, result.channelId);
    this.emit(ActivityEvents.Message, {
      ...result,
      totalMessages: user.messages.total,
    });
  }

  // ─── Публичное API для других модулей ──────────────────

  getStorage(): ActivityStorage {
    return this.storage;
  }

  /** Текущее время юзера в войсе (сек), null если не в войсе */
  getLiveVoiceDuration(guildId: string, userId: string): number | null {
    return this.voiceTracker.getCurrentDuration(guildId, userId);
  }

  /** Общее время в войсе (записанное + текущая сессия) */
  getTotalVoiceTime(guildId: string, userId: string): number {
    const saved = this.storage.getUser(guildId, userId).voice.totalSeconds;
    const live  = this.voiceTracker.getCurrentDuration(guildId, userId) ?? 0;
    return saved + live;
  }

  /** Общее число учтённых сообщений */
  getTotalMessages(guildId: string, userId: string): number {
    return this.storage.getUser(guildId, userId).messages.total;
  }
}