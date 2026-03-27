// ─── Активная войс-сессия (in-memory) ───────────────────────
export interface VoiceSession {
  discordId:   string; 
  guildId:     string;
  channelId:   string;
  joinedAt:    number;  
  selfMute:    boolean;
  selfDeaf:    boolean;
  serverMute:  boolean;
  serverDeaf:  boolean;
  streaming:   boolean;
}

// ─── Запись активности пользователя (persistent) ─────────────
export interface UserActivity {
  discordId:   string;
  guildId: string;
  voice: {
    totalSeconds:  number;
    sessionCount:  number;
    lastJoinAt:    number | null;
    lastLeaveAt:   number | null;
    // сколько секунд провёл в каждом канале
    perChannel: Record<string, number>;
  };

  messages: {
    total:     number;
    lastAt:    number | null;
    perChannel: Record<string, number>;
  };

  // ежедневная статистика (сбрасывается автоматически)
  daily: {
    date:          string;  // "2026-03-02"
    voiceSeconds:  number;
    messages:      number;
  };
}

// ─── Формат JSON-файла ──────────────────────────────────────
export interface ActivityDatabase {
  version: number;
  lastSave: number;
  // ключ: "guildId:userId"
  users: Record<string, UserActivity>;
}

// ─── Настройки трекера ──────────────────────────────────────
export interface TrackerConfig {
  /** Папка для хранения данных */
  dataDir: string;
  /** Как часто сохранять на диск (мс) */
  saveIntervalMs: number;
  /** Минимальная сессия для учёта (сек) */
  minSessionSec: number;
  /** Кулдаун между учётом сообщений одного юзера (мс) */
  messageCooldownMs: number;
  /** Игнорировать AFK-канал сервера */
  ignoreAfkChannel: boolean;
  /** Игнорировать ботов */
  ignoreBots: boolean;
  /** Считать время если selfDeaf */
  countSelfDeaf: boolean;
  /** Каналы-исключения (ID) */
  ignoredChannels: string[];
}

export const DEFAULT_CONFIG: TrackerConfig = {
  dataDir:           './data',
  saveIntervalMs:    60_000,   // 1 минута
  minSessionSec:     10,
  messageCooldownMs: 5_000,    // 5 секунд
  ignoreAfkChannel:  true,
  ignoreBots:        true,
  countSelfDeaf:     false,
  ignoredChannels:   [],
};

// ─── События менеджера (для подписки из других модулей) ──────
export enum ActivityEvents {
  VoiceJoin       = 'activityVoiceJoin',
  VoiceLeave      = 'activityVoiceLeave',
  VoiceSwitch     = 'activityVoiceSwitch',
  VoiceTimeUpdate = 'activityVoiceTimeUpdate',
  Message         = 'activityMessage',
  Save            = 'activitySave',
}

export interface VoiceJoinPayload {
  userId: string;
  guildId: string;
  channelId: string;
  timestamp: number;
}

export interface VoiceLeavePayload {
  userId: string;
  guildId: string;
  channelId: string;
  durationSec: number;
  timestamp: number;
}

export interface MessagePayload {
  userId: string;
  guildId: string;
  channelId: string;
  timestamp: number;
  totalMessages: number;
}