// ДЕФОЛТНЫЕ ЗНАЧЕНИЯ — LOGS CONFIG
// ⚠️ НЕ РЕДАКТИРУЙ ЭТОТ ФАЙЛ — Редактируй cfg.logs.yaml
// ═══════════════════════════════════════════════════════════

import type { 
  LogsConfig, 
  LogCategories,
  ErrorHandlerSettings 
} from "../types/config.types.js";


// КАТЕГОРИИ ЛОГИРОВАНИЯ
const defaultCategories: LogCategories = {
  // Система
  STARTUP: true,
  SHUTDOWN: true,
  COMMANDS: true,
  EVENTS: true,
  
  // Сервисы
  MUSIC: true,
  VOICE_TRACKER: true,
  MONITOR: true,
  
  // База данных
  DATABASE: true,
  MONGO_SYNC: true,
  STAFF_DB: true,
  
  // Детальное (отключено по умолчанию)
  COMMAND_LOAD: false,
  EVENT_LOAD: false,
  DB_OPERATIONS: false,
  WRAPPER_LOGS: false,
};

// ПРЕСЕТЫ ЛОГИРОВАНИЯ
const presets = {
  production: {
    STARTUP: true,
    SHUTDOWN: true,
    COMMANDS: true,
    EVENTS: false,
    DATABASE: true,
    MUSIC: false,
    VOICE_TRACKER: false,
  },
  
  development: {
    STARTUP: true,
    SHUTDOWN: true,
    COMMANDS: true,
    EVENTS: true,
    DATABASE: true,
    COMMAND_LOAD: true,
    EVENT_LOAD: true,
  },
  
  debug: {
    ...defaultCategories,
    COMMAND_LOAD: true,
    EVENT_LOAD: true,
    DB_OPERATIONS: true,
    WRAPPER_LOGS: true,
  },
} as const;

// ОСНОВНЫЕ НАСТРОЙКИ ЛОГОВ
const defaultLogs: LogsConfig = {
  // Идентификация
  botName: "${BOT_NAME:Bot}",
  
  // Пути
  logsDir: "",
  archiveDir: "",
  
  // Временные настройки
  timezone: "Europe/Moscow",
  dateFormat: "YYYY-MM-DD HH:mm:ss",
  fileDateFormat: "YYYY-MM-DD",
  
  // Размеры и лимиты
  maxFileSizeMB: 10,
  keepArchiveDays: 30,
  maxBufferSize: 100,
  
  // Производительность
  flushIntervalMs: 5000,
  compressionLevel: 6,
  
  // Поведение
  interceptConsole: false,
  includeStackTrace: true,
  jsonMaxDepth: 3,
  
  // Уровни
  minLevel: "INFO",
  enabledLevels: {
    info: true,
    error: true,
    warn: true,
  },
  
  // Режим и категории
  mode: "production",
  categories: defaultCategories,
};

// ERROR HANDLER
const defaultErrorHandler: ErrorHandlerSettings = {
  // Основное
  enabled: true,
  errorChannelId: "", // Если пусто → LogChannels.trashes.other
  crashLogsDir: "",

  // Discord сообщения
  maxStackLength: 1500,
  sendDelayMs: 500,
  maxQueueSize: 50,
  sendWarnings: false,
  
  // Игнорируемые ошибки (частые/неважные)
  ignorePatterns: [
    // Сетевые
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "getaddrinfo",
    "EAI_AGAIN",
    
    // Discord API
    "Unknown Message",
    "Unknown interaction",
    "Unknown Channel",
    "Missing Access",
    "Missing Permissions",
    "Cannot send messages to this user",
    "DiscordAPIError[50013]",
    "DiscordAPIError[10008]",
    "DiscordAPIError[10062]",
    
    // Rate limits (обрабатываются discord.js)
    "RateLimited",
  ],
};

// ЭКСПОРТ
export interface LogsConfigData {
  logs: LogsConfig;
  errorHandler: ErrorHandlerSettings;
  presets: typeof presets;
}

export const logsDefaults: LogsConfigData = {
  logs: defaultLogs,
  errorHandler: defaultErrorHandler,
  presets,
};

// Реэкспорт для удобства
export type { ErrorHandlerSettings };