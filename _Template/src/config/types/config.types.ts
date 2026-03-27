// ВСЕ ТИПЫ И ИНТЕРФЕЙСЫ КОНФИГУРАЦИИ
// ═══════════════════════════════════════════════════════════

import { ActivityType } from "discord.js";

// ЛОГИРОВАНИЕ (LOGS CONFIG)
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SILENT";
export type LogMode = "production" | "development" | "debug";

export const LogLevelPriority: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 99,
};

export interface LogCategories {
  // Система
  STARTUP: boolean;
  SHUTDOWN: boolean;
  COMMANDS: boolean;
  EVENTS: boolean;
  
  // Сервисы
  MUSIC: boolean;
  VOICE_TRACKER: boolean;
  MONITOR: boolean;
  
  // База данных
  DATABASE: boolean;
  MONGO_SYNC: boolean;
  STAFF_DB: boolean;
  
  // Детальное логирование
  COMMAND_LOAD: boolean;
  EVENT_LOAD: boolean;
  DB_OPERATIONS: boolean;
  WRAPPER_LOGS: boolean;
}

export interface LogsConfig {
  botName: string;
  logsDir: string;
  archiveDir: string;
  timezone: string;
  maxFileSizeMB: number;
  keepArchiveDays: number;
  flushIntervalMs: number;
  maxBufferSize: number;
  compressionLevel: number;
  interceptConsole: boolean;
  
  enabledLevels: {
    info: boolean;
    error: boolean;
    warn: boolean;
  };
  
  dateFormat: string;
  fileDateFormat: string;
  includeStackTrace: boolean;
  jsonMaxDepth: number;
  
  minLevel: LogLevel;
  categories: LogCategories;
  mode: LogMode;
}

// СЕРВЕР / ГИЛЬДИЯ (SERVER DATA)
export interface GuildConfig {
  id: string;
  name: string;
  avatar: string;
  banner: string;
}

export interface ManagementRoles {
  manager: string;
  representative: string;
}

export interface RolesConfig {
  owner: string;
  management: ManagementRoles;
  targetStaff: string;
  otherRoles: string[];
}

export interface VoiceChannelsConfig {
  urlVoice: string;
  main: string;
  createTemp: string;
  staffvoice: string;
  lobbys: string[];
  staff: string[];
  afk: string;
}

export interface TextChannelsConfig {
  rule: string;
  info: string;
  news: string;
  chat: string;
  cmd_chat: string;
  nsfw_chat: string;
  danger_zone: string;
  staff: string[];
}

export interface LogChannelsGroup {
  discord: string;
  database: string;
  audit: string;
  other: string;
}

export interface GeneralLogChannelsGroup {
  bots: string;
  users: string;
  server: string;
  other: string;
}

export interface LogChannelsConfig {
  trashes: LogChannelsGroup;
  general: GeneralLogChannelsGroup;
  staff: string[];
}

export interface ChannelsConfig {
  voice: VoiceChannelsConfig;
  text: TextChannelsConfig;
  logs: LogChannelsConfig;
}

export interface VoiceSettings {
  VoiceOn: boolean;
  connectionVoiceChannel: string;
}

export type BotStatus = "online" | "dnd" | "invisible" | "idle";

export interface BotProfileSettings {
  typeStatus: BotStatus;
  textActivity: string;
  typeActivity: ActivityType;
  statusUrl: string;
}

export interface ServerDataConfig {
  guild: GuildConfig;
  roles: RolesConfig;
  channels: ChannelsConfig;
  voiceSettings: VoiceSettings;
  botProfileSettings: BotProfileSettings;
}

// ТАЙМИНГИ (TIMINGS CONFIG)
export interface CooldownsConfig {
  global: number;
  maxAge: number;
}

export interface PunishmentConfig {
  timeout: number;
  penalty: number;
  max: number;
  checkInterval: number;
}

export interface AutoDeleteConfig {
  global: number;
  command: number;
  error: number;
  success: number;
  warning: number;
  failure: number;
  system: number;
}

export interface CollectorsConfig {
  default: number;
  reaction: number;
  message: number;
  button: number;
  selectMenu: number;
  modal: number;
}

export interface MusicSchedule {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

export interface MusicConfig {
  musicDir: string;
  volume: number;
  loop: boolean;
  shuffle: boolean;
  supportedFormats: string[];
  connectionTimeout: number;
  selfDeaf: boolean;
  selfMute: boolean;
  maxErrors: number;
  retryDelay: number;
  autoReconnect: boolean;
  reconnectAttempts: number;
  announceTrack: boolean;
  fadeEnabled: boolean;
  fadeDuration: number;
  schedule: MusicSchedule;
}

export interface SystemConfig {
  autoSavetoDB: number;
  logDelaySaves: number;
  cleanupMessages: number;
}

export interface TimingsConfig {
  cooldowns: CooldownsConfig;
  autoPunishment: PunishmentConfig;
  autoDelete: AutoDeleteConfig;
  collectors: CollectorsConfig;
  musicConfig: MusicConfig;
  system: SystemConfig;
}

// БАЗА ДАННЫХ (DATABASE CONFIG)
export interface LocalDBConfig {
  enabled: boolean;
  fileName: string;
  directory: string;
  saveDebounceMs: number;
  backupOnCorrupted: boolean;
  validateOnLoad: boolean;
  repairOnError: boolean;
}

export interface MongoAutoSync {
  enabled: boolean;
  intervalMs: number;
}

export interface MongoDBConfig {
  enabled: boolean;
  database: string;
  collection: string;
  autoSync: MongoAutoSync;
  connectionTimeout: number;
  serverSelectionTimeout: number;
}

export interface DBLoggingConfig {
  logLoads: boolean;
  logSaves: boolean;
  logRepairs: boolean;
  logSync: boolean;
}

export interface DatabaseConfig {
  local: LocalDBConfig;
  mongo: MongoDBConfig;
  logging: DBLoggingConfig;
}

// ERROR HANDLER
export interface ErrorHandlerSettings {
  /** Включить систему */
  enabled: boolean;
  /** ID канала для ошибок (если пусто — из LogChannels.trashes.other) */
  errorChannelId: string;
  /** Директория для crash-логов */
  crashLogsDir: string;
  /** Максимальная длина stack trace в Discord */
  maxStackLength: number;
  /** Задержка между отправкой ошибок (мс) */
  sendDelayMs: number;
  /** Максимум ошибок в очереди */
  maxQueueSize: number;
  /** Отправлять Node.js warnings */
  sendWarnings: boolean;
  /** Паттерны для игнорирования (строки → RegExp) */
  ignorePatterns: string[];
}

// ИЕРАРХИЯ / ДОСТУП
export type AccessLevelName = 
  | "owner" 
  | "management" 
  | "representative"
  | "workers"
  | "staff";

export type AccessLevelsMap = Record<AccessLevelName, readonly string[]>;