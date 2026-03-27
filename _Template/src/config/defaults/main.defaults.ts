// ДЕФОЛТНЫЕ ЗНАЧЕНИЯ — MAIN CONFIG
// ⚠️ НЕ РЕДАКТИРУЙ ЭТОТ ФАЙЛ — Редактируй cfg.main.yaml
// ═══════════════════════════════════════════════════════════

import type {
  ServerDataConfig,
  TimingsConfig,
  DatabaseConfig,
} from "../types/config.types.js";


// СЕРВЕРНЫЕ ДАННЫЕ
export const defaultServerData: ServerDataConfig = {
  guild: {
    // Используем переменную окружения или заглушку
    id: "${GUILD_ID:INSERT_GUILD_ID_HERE}", 
    name: "${GUILD_NAME:SERVER NAME}",
    avatar: "${GUILD_AVATAR:}", // Пустая строка по дефолту
    banner: "",
  },

  roles: {
    owner: "INSERT_OWNER_ROLE_ID",
    management: {
      manager: "INSERT_ROLE_ID",
      representative: "INSERT_ROLE_ID",
    },
    targetStaff: "INSERT_ROLE_ID",
    otherRoles: [], // Пустой массив
  },

  channels: {
    voice: {
      urlVoice: "INSERT_CHANNEL_ID",
      main: "INSERT_CHANNEL_ID",
      createTemp: "INSERT_CHANNEL_ID",
      staffvoice: "INSERT_CHANNEL_ID",
      lobbys: [],
      staff: [],
      afk: "INSERT_CHANNEL_ID",
    },
    text: {
        rule: "INSERT_CHANNEL_ID",
        info: "INSERT_CHANNEL_ID",
        news: "INSERT_CHANNEL_ID",
        chat: "INSERT_CHANNEL_ID",
        cmd_chat: "INSERT_CHANNEL_ID",
        nsfw_chat: "INSERT_CHANNEL_ID",
        danger_zone: "INSERT_CHANNEL_ID",
        staff: [],
    },
    logs: {
        trashes:{
            discord: "INSERT_CHANNEL_ID",
            database: "INSERT_CHANNEL_ID",
            audit: "INSERT_CHANNEL_ID",
            other: "INSERT_CHANNEL_ID",
        },
        general:{
            bots: "INSERT_CHANNEL_ID",
            users: "INSERT_CHANNEL_ID",
            server: "INSERT_CHANNEL_ID",
            other: "INSERT_CHANNEL_ID",
        },
        staff: [],
    },
  },

  voiceSettings: {
    VoiceOn: false,
    connectionVoiceChannel: "INSERT_VOICE_CHANNEL_ID",
  },

  botProfileSettings: {
    typeStatus: "online",
    textActivity: "🌠 | Setup Mode",
    // 0 = Playing, 1 = Streaming, 2 = Listening, 3 = Watching, 5 = Competing
    typeActivity: 3,
    statusUrl: "",
  },
};


// ТАЙМИНГИ
export const defaultTimings: TimingsConfig = {

  cooldowns: {
    global: 300000,           // 5m
    maxAge: 1800000,          // 30m
  },

  autoPunishment: {
    timeout: 600000,          // 10m
    penalty: 1,
    max: 3,
    checkInterval: 60000,     // 1m
  },

  autoDelete: {
    global: 60000,            // 1m
    command: 60000,           // 1m
    error: 60000,             // 1m
    success: 60000,           // 1m
    warning: 60000,           // 1m
    failure: 60000,           // 1m
    system: 60000,            // 1m
  },

  collectors: {
    default: 60000,           // 1m
    reaction: 60000,          // 1m
    message: 60000,           // 1m
    button: 60000,            // 1m
    selectMenu: 60000,        // 1m
    modal: 60000,             // 1m
  },

  musicConfig: {
    musicDir: "./config/music",
    volume: 1.0,
    loop: false,
    shuffle: false,
    supportedFormats: [".mp3", ".ogg", ".wav", ".webm", ".flac", ".m4a"],
    connectionTimeout: 30000,
    selfDeaf: false,
    selfMute: false,
    maxErrors: 3,
    retryDelay: 1000,
    autoReconnect: true,
    reconnectAttempts: 5,
    announceTrack: false,
    fadeEnabled: true,
    fadeDuration: 500,
    schedule: {
      enabled: true,
      startTime: "06:00",
      endTime: "20:00",
    },
  },

  system: {
    autoSavetoDB: 60000,           // 1m
    logDelaySaves: 10,
    cleanupMessages: 10,
  },
};

// БАЗА ДАННЫХ
export const defaultDatabase: DatabaseConfig = {
  local: {
    enabled: true,
    fileName: "database.local.json",
    directory: "../data/configs/db",
    saveDebounceMs: 1000,
    backupOnCorrupted: true,
    validateOnLoad: true,
    repairOnError: true,
  },

  mongo: {
    enabled: false,
    database: "BotName",
    collection: "staff",
    autoSync: {
      enabled: true,
      intervalMs: 300000,          // 5m
    },
    connectionTimeout: 10000,
    serverSelectionTimeout: 5000,
  },

  logging: {
    logLoads: false,
    logSaves: false,
    logRepairs: true,
    logSync: false,
  },
};

// СКРЫТЫЕ РОЛИ
export const defaultHiddenRoles: string[] = [
    "INSERT_ROLE_ID",
];


// ПОЛНЫЙ ДЕФОЛТНЫЙ ОБЪЕКТ
export interface MainConfigData {
  server: ServerDataConfig;
  timings: TimingsConfig;
  database: DatabaseConfig;
  hiddenRoles: string[];
}

export const mainDefaults: MainConfigData = {
  server: defaultServerData,
  timings: defaultTimings,
  database: defaultDatabase,
  hiddenRoles: defaultHiddenRoles,
};