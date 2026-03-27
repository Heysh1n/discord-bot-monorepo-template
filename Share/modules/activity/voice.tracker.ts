import type { VoiceState } from 'discord.js';
import type { VoiceSession, TrackerConfig } from './activity.types';

export class VoiceTracker {
  // ключ: "guildId:userId", значение: активная сессия
  private sessions = new Map<string, VoiceSession>();

  constructor(private config: TrackerConfig) {}

  private key(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  // ─── Обработка voiceStateUpdate ─────────────────────────

  /**
   * Возвращает что произошло:
   * - 'join'   → пользователь зашёл в войс
   * - 'leave'  → вышел, возвращает длительность
   * - 'switch' → переключился, возвращает длительность старого канала
   * - 'update' → изменился mute/deaf/stream (без смены канала)
   * - null      → ничего интересного или игнорируем
   */
  processUpdate(oldState: VoiceState, newState: VoiceState): VoiceUpdateResult | null {
    const userId  = newState.id;
    const guildId = newState.guild.id;
    const k       = this.key(guildId, userId);

    const member = newState.member ?? oldState.member;
    if (!member) return null;

    // Игнорируем ботов
    if (this.config.ignoreBots && member.user.bot) return null;

    const oldCh = oldState.channelId;
    const newCh = newState.channelId;

    // Игнорируем AFK-канал
    const afkChId = newState.guild.afkChannelId;

    // ── JOIN ──────────────────────────────────────────────
    if (!oldCh && newCh) {
      if (this.shouldIgnoreChannel(newCh, afkChId)) return null;
      if (!this.shouldCount(newState)) return null;

      const session: VoiceSession = {
        discordId:   userId,
        guildId:     guildId,
        channelId:   newCh,
        joinedAt:    Date.now(),
        selfMute:    newState.selfMute ?? false,
        selfDeaf:    newState.selfDeaf ?? false,
        serverMute:  newState.serverMute ?? false,
        serverDeaf:  newState.serverDeaf ?? false,
        streaming:   newState.streaming ?? false,
      };
      this.sessions.set(k, session);

      return { type: 'join', userId, guildId, channelId: newCh };
    }

    // ── LEAVE ─────────────────────────────────────────────
    if (oldCh && !newCh) {
      const session = this.sessions.get(k);
      this.sessions.delete(k);

      if (!session) return null;
      const duration = this.calcDuration(session);
      if (duration < this.config.minSessionSec) return null;

      return {
        type: 'leave',
        userId, guildId,
        channelId:   session.channelId,
        durationSec: duration,
      };
    }

    // ── SWITCH ────────────────────────────────────────────
    if (oldCh && newCh && oldCh !== newCh) {
      const oldSession = this.sessions.get(k);
      let leaveDuration = 0;
      let leaveChannel  = oldCh;

      if (oldSession) {
        leaveDuration = this.calcDuration(oldSession);
        leaveChannel  = oldSession.channelId;
      }

      // Начинаем новую сессию (если канал не игнорируется)
      if (!this.shouldIgnoreChannel(newCh, afkChId) && this.shouldCount(newState)) {
        this.sessions.set(k, {
          discordId:   userId,
          guildId,
          channelId:   newCh,
          joinedAt:    Date.now(),
          selfMute:    newState.selfMute ?? false,
          selfDeaf:    newState.selfDeaf ?? false,
          serverMute:  newState.serverMute ?? false,
          serverDeaf:  newState.serverDeaf ?? false,
          streaming:   newState.streaming ?? false,
        });
      } else {
        this.sessions.delete(k);
      }

      if (leaveDuration < this.config.minSessionSec) {
        return { type: 'join', userId, guildId, channelId: newCh };
      }

      return {
        type: 'switch',
        userId, guildId,
        channelId:    newCh,
        oldChannelId: leaveChannel,
        durationSec:  leaveDuration,
      };
    }

    // ── UPDATE (mute/deaf/stream) ─────────────────────────
    if (oldCh && newCh && oldCh === newCh) {
      const session = this.sessions.get(k);

      // Стал selfDeaf и мы не считаем → завершаем сессию
      if (session && !this.shouldCount(newState)) {
        this.sessions.delete(k);
        const duration = this.calcDuration(session);
        if (duration >= this.config.minSessionSec) {
          return {
            type: 'leave',
            userId, guildId,
            channelId:   session.channelId,
            durationSec: duration,
          };
        }
        return null;
      }

      // Был selfDeaf, перестал → начинаем сессию
      if (!session && this.shouldCount(newState) && !this.shouldIgnoreChannel(newCh, afkChId)) {
        this.sessions.set(k, {
          discordId: userId, guildId,
          channelId: newCh,
          joinedAt: Date.now(),
          selfMute:   newState.selfMute ?? false,
          selfDeaf:   newState.selfDeaf ?? false,
          serverMute: newState.serverMute ?? false,
          serverDeaf: newState.serverDeaf ?? false,
          streaming:  newState.streaming ?? false,
        });
        return { type: 'join', userId, guildId, channelId: newCh };
      }

      // Обновляем состояние сессии
      if (session) {
        session.selfMute   = newState.selfMute ?? false;
        session.selfDeaf   = newState.selfDeaf ?? false;
        session.serverMute = newState.serverMute ?? false;
        session.serverDeaf = newState.serverDeaf ?? false;
        session.streaming  = newState.streaming ?? false;
      }

      return null; // тихое обновление
    }

    return null;
  }

  // ─── Утилиты ────────────────────────────────────────────

  private calcDuration(session: VoiceSession): number {
    return Math.floor((Date.now() - session.joinedAt) / 1000);
  }

  private shouldCount(state: VoiceState): boolean {
    if (!this.config.countSelfDeaf && state.selfDeaf) return false;
    return true;
  }

  private shouldIgnoreChannel(channelId: string, afkChannelId: string | null): boolean {
    if (this.config.ignoredChannels.includes(channelId)) return true;
    if (this.config.ignoreAfkChannel && channelId === afkChannelId) return true;
    return false;
  }

  /** Получить все активные сессии (для сохранения при shutdown) */
  getActiveSessions(): Map<string, VoiceSession> {
    return new Map(this.sessions);
  }

  /** Текущее время в войсе для конкретного пользователя */
  getCurrentDuration(guildId: string, userId: string): number | null {
    const session = this.sessions.get(this.key(guildId, userId));
    if (!session) return null;
    return this.calcDuration(session);
  }

  /** Завершить все сессии (при shutdown) — возвращает массив результатов */
  flushAll(): VoiceLeaveResult[] {
    const results: VoiceLeaveResult[] = [];
    for (const [, session] of this.sessions) {
      const duration = this.calcDuration(session);
      if (duration >= this.config.minSessionSec) {
        results.push({
          type: 'leave',
          userId:      session.discordId,
          guildId:     session.guildId,
          channelId:   session.channelId,
          durationSec: duration,
        });
      }
    }
    this.sessions.clear();
    return results;
  }
}

// ─── Типы результатов ─────────────────────────────────────

export type VoiceUpdateResult =
  | VoiceJoinResult
  | VoiceLeaveResult
  | VoiceSwitchResult;

export interface VoiceJoinResult {
  type: 'join';
  userId: string;
  guildId: string;
  channelId: string;
}

export interface VoiceLeaveResult {
  type: 'leave';
  userId: string;
  guildId: string;
  channelId: string;
  durationSec: number;
}

export interface VoiceSwitchResult {
  type: 'switch';
  userId: string;
  guildId: string;
  channelId: string;
  oldChannelId: string;
  durationSec: number;
}