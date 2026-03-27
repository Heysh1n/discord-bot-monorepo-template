import path from "path";
import { ActivityType } from "discord.js";
import { ConfigManager } from "@share/modules/configs/cfg.manager.js";
import { getBotPaths } from "@share/constants.js";

// Дефолты
import { mainDefaults } from "./defaults/main.defaults.js";
import type { MainConfigData } from "./defaults/main.defaults.js";
import { logsDefaults } from "./defaults/logs.defaults.js";
import type { LogsConfigData } from "./defaults/logs.defaults.js";
import { permsDefaults } from "./defaults/perms.defaults.js";
import type { PermsConfigData, PermissionRule } from "./defaults/perms.defaults.js";
import type { ConfigName, ConfigChangeEvent } from "@share/modules/configs/cfg.types.js";

// Типы
import type {
  ServerDataConfig,
  TimingsConfig,
  DatabaseConfig,
  LogsConfig,
  LogCategories,
  LogLevel,
  AccessLevelName,
  GuildConfig,
  RolesConfig,
  ManagementRoles,
  ChannelsConfig,
  VoiceChannelsConfig,
  TextChannelsConfig,
  LogChannelsConfig,
  VoiceSettings,
  BotProfileSettings,
  CooldownsConfig,
  PunishmentConfig,
  AutoDeleteConfig,
  CollectorsConfig,
  MusicConfig,
  SystemConfig,
  ErrorHandlerSettings,
} from "./types/config.types.js";

import { LogLevelPriority } from "./types/config.types.js";


// ЛЕНИВАЯ ИНИЦИАЛИЗАЦИЯ

// Порядок:
//   1. import config.ts        ← модуль загружается, manager = null
//   2. initBotPaths("_Template") ← BotPaths готов
//   3. ServerData.guild.id     ← первый доступ → getManager() → init


let _manager: ConfigManager | null = null;
let _configDir: string = "";
let _dataDir: string = "";

function ensureManager(): ConfigManager {
  if (_manager) return _manager;
  const bp = getBotPaths();
  _configDir = bp.configs;
  _dataDir = bp.data;

  _manager = new ConfigManager({
    configDir: _configDir,
    hotReload: true,
    hotReloadDebounce: 1000,
    verbose: true,
  });

  // Регистрация всех конфигов

  _manager.register<MainConfigData>({
    name: "main",
    defaults: mainDefaults,
    yamlPath: path.join(_configDir, "cfg.main.yaml"),
    transform: transformMainConfig,
  });

  _manager.register<LogsConfigData>({
    name: "logs",
    defaults: logsDefaults,
    yamlPath: path.join(_configDir, "cfg.logs.yaml"),
    transform: transformLogsConfig,
  });

  _manager.register<PermsConfigData>({
    name: "perms",
    defaults: permsDefaults,
    yamlPath: path.join(_configDir, "cfg.perms.yaml"),
  });

  return _manager;
}

// ТРАНСФОРМАЦИИ
function transformMainConfig(raw: Record<string, unknown>): MainConfigData {
  const data = raw as unknown as MainConfigData;

  // ActivityType: строка → число
  if (data.server?.botProfileSettings) {
    const profile = data.server.botProfileSettings;
    if (typeof profile.typeActivity === "string") {
      const mapping: Record<string, ActivityType> = {
        Playing: ActivityType.Playing,
        Streaming: ActivityType.Streaming,
        Listening: ActivityType.Listening,
        Watching: ActivityType.Watching,
        Custom: ActivityType.Custom,
        Competing: ActivityType.Competing,
      };
      (profile as unknown as Record<string, unknown>).typeActivity =
        mapping[profile.typeActivity as unknown as string] ?? ActivityType.Watching;
    }
  }
  if (data.timings?.musicConfig?.musicDir) {
    const musicDir = data.timings.musicConfig.musicDir;
    if (!path.isAbsolute(musicDir)) {
      data.timings.musicConfig.musicDir = path.resolve(_dataDir, musicDir);
    }
  }

  return data;
}

function transformLogsConfig(raw: Record<string, unknown>): LogsConfigData {
  const data = raw as unknown as LogsConfigData;
  const bp = getBotPaths();

  if (data.logs) {
    if (!data.logs.logsDir || data.logs.logsDir.startsWith("./")) {
      data.logs.logsDir = bp.logs;
    }
    
    if (!data.logs.archiveDir || data.logs.archiveDir.startsWith("./")) {
      data.logs.archiveDir = bp.archive;
    }

    if (data.logs.mode && data.presets) {
      const mode = data.logs.mode as keyof typeof data.presets;
      const preset = data.presets[mode];
      if (preset) {
        data.logs.categories = { ...preset, ...data.logs.categories };
      }
    }
  }
  if (data.errorHandler) {
    if (!data.errorHandler.crashLogsDir || data.errorHandler.crashLogsDir.startsWith("./") || data.errorHandler.crashLogsDir === "/crashes") {
      data.errorHandler.crashLogsDir = bp.crashes;
    }
  }

  return data;
}

// ГЕТТЕРЫ 
function getMain(): MainConfigData {
  return ensureManager().get<MainConfigData>("main");
}

function getLogs(): LogsConfigData {
  return ensureManager().get<LogsConfigData>("logs");
}

function getPerms(): PermsConfigData {
  return ensureManager().get<PermsConfigData>("perms");
}


// PROXY FACTORY
function createProxy<T extends object>(getter: () => T): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      const target = getter();
      const value = Reflect.get(target, prop);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return createProxy(() => Reflect.get(getter(), prop) as T);
      }
      return value;
    },
    has: (_, prop) => Reflect.has(getter(), prop),
    ownKeys: () => Reflect.ownKeys(getter()),
    getOwnPropertyDescriptor: (_, prop) => {
      const target = getter();
      if (Reflect.has(target, prop)) {
        return {
          configurable: true,
          enumerable: true,
          value: Reflect.get(target, prop),
        };
      }
      return undefined;
    },
  });
}


// ЭКСПОРТЫ 

// Error Handler 

export const ErrorHandlerCfg = createProxy<ErrorHandlerSettings>(
  () => getLogs().errorHandler
);

export function getErrorChannelId(): string {
  const cfg = getLogs().errorHandler;
  if (cfg.errorChannelId && cfg.errorChannelId.length > 0) {
    return cfg.errorChannelId;
  }
  return getMain().server.channels.logs.trashes.other;
}

export function getIgnorePatterns(): RegExp[] {
  return getLogs().errorHandler.ignorePatterns.map(pattern => {
    try {
      return new RegExp(pattern, 'i');
    } catch {
      return new RegExp(escapeRegExp(pattern), 'i');
    }
  });
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Server

export const ServerData = createProxy<ServerDataConfig>(() => getMain().server);
export const GuildData = createProxy<GuildConfig>(() => getMain().server.guild);
export const RolesData = createProxy<RolesConfig>(() => getMain().server.roles);
export const ManageRoles = createProxy<ManagementRoles>(
  () => getMain().server.roles.management
);

export const ChannelsData = createProxy<ChannelsConfig>(
  () => getMain().server.channels
);
export const VoiceChannels = createProxy<VoiceChannelsConfig>(
  () => getMain().server.channels.voice
);
export const TextChannels = createProxy<TextChannelsConfig>(
  () => getMain().server.channels.text
);
export const LogChannels = createProxy<LogChannelsConfig>(
  () => getMain().server.channels.logs
);

export const VoiceData = createProxy<VoiceSettings>(
  () => getMain().server.voiceSettings
);
export const StatusData = createProxy<BotProfileSettings>(
  () => getMain().server.botProfileSettings
);

// Timings

export const Timings = createProxy<TimingsConfig>(() => getMain().timings);
export const Cooldowns = createProxy<CooldownsConfig>(
  () => getMain().timings.cooldowns
);
export const PunishmentCfg = createProxy<PunishmentConfig>(
  () => getMain().timings.autoPunishment
);
export const AutoDelete = createProxy<AutoDeleteConfig>(
  () => getMain().timings.autoDelete
);
export const CollectorsCfg = createProxy<CollectorsConfig>(
  () => getMain().timings.collectors
);
export const MusicCfg = createProxy<MusicConfig>(
  () => getMain().timings.musicConfig
);
export const SystemCfg = createProxy<SystemConfig>(
  () => getMain().timings.system
);

// Database

export const DatabaseSettings = createProxy<DatabaseConfig>(
  () => getMain().database
);
export const LocalDBCfg = createProxy<DatabaseConfig["local"]>(
  () => getMain().database.local
);
export const MongoDBCfg = createProxy<DatabaseConfig["mongo"]>(
  () => getMain().database.mongo
);
export const DBLoggingCfg = createProxy<DatabaseConfig["logging"]>(
  () => getMain().database.logging
);

//  Logs

export const logsSettings = createProxy<LogsConfig>(() => getLogs().logs);

// Hidden Roles 

export function getHiddenRoles(): string[] {
  return getMain().hiddenRoles;
}


// PERMISSIONS
export function getPermissionGroup(name: string): PermissionRule | undefined {
  return getPerms().accessGroups[name];
}

export function getAllAccessGroups(): Record<string, PermissionRule> {
  return getPerms().accessGroups;
}

export function getHierarchyOrder(): AccessLevelName[] {
  return getPerms().hierarchyOrder;
}

export function getSeniorLevels(): AccessLevelName[] {
  return getPerms().seniorLevels;
}

export function getAccessLevels(): Record<AccessLevelName, readonly string[]> {
  const roles = getMain().server.roles;
  return {
    owner: [roles.owner],
    management: [
      roles.management.manager,
      roles.management.representative,
    ],
    representative: [roles.management.representative],
    workers: [],
    staff: [roles.targetStaff, ...roles.otherRoles],
  };
}

export function getHierarchyRoles(): string[] {
  const levels = getAccessLevels();
  return getPerms().hierarchyOrder.flatMap((level) => [...levels[level]]);
}

export function getSeniorRoles(): string[] {
  const levels = getAccessLevels();
  return getPerms().seniorLevels.flatMap((level) => [...levels[level]]);
}

export function getJuniorRoles(): string[] {
  const levels = getAccessLevels();
  const seniors = getPerms().seniorLevels;
  return getPerms()
    .hierarchyOrder.filter((level) => !seniors.includes(level))
    .flatMap((level) => [...levels[level]]);
}

export function getAllStaffRoles(): string[] {
  return getHierarchyRoles();
}

export function getRoleToLevel(): Record<string, AccessLevelName> {
  const levels = getAccessLevels();
  return Object.fromEntries(
    getPerms().hierarchyOrder.flatMap((level) =>
      levels[level].map((roleId) => [roleId, level])
    )
  );
}

// ХЕЛПЕРЫ
export function isRoleInLevel(roleId: string, level: AccessLevelName): boolean {
  const levels = getAccessLevels();
  return levels[level]?.includes(roleId) ?? false;
}

export function getRoleLevel(roleId: string): AccessLevelName | null {
  return getRoleToLevel()[roleId] ?? null;
}

export function isCategoryEnabled(category: keyof LogCategories): boolean {
  return getLogs().logs.categories[category] ?? true;
}

export function isLevelEnabled(level: LogLevel): boolean {
  const currentMin = getLogs().logs.minLevel;
  return LogLevelPriority[level] >= LogLevelPriority[currentMin];
}

// ЭКСПОРТ МЕНЕДЖЕРА (без Proxy — методы должны работать!)
export function getConfigManagerInstance(): ConfigManager {
  return ensureManager();
}
export const configManager = {
  get instance() {
    return ensureManager();
  },
  getStatus() {
    return ensureManager().getStatus();
  },
  reload(name: ConfigName) {
    return ensureManager().reload(name);
  },
  reloadAll() {
    return ensureManager().reloadAll();
  },
  destroy() {
    return ensureManager().destroy();
  },
  onAnyChange(listener: (event: ConfigChangeEvent) => void) {
    return ensureManager().onAnyChange(listener);
  },
  reloadConfig(name: ConfigName) {
    return ensureManager().reload(name);
  },
  reloadAllConfigs() {
    return ensureManager().reloadAll();
  },
  resetToDefaults(name: ConfigName) {
    return ensureManager().resetToDefaults(name);
  },
};

// СОВМЕСТИМОСТЬ
export const logsConfig = logsSettings;
export function validateLogsConfig(config: LogsConfig): void {
  if (!config.logsDir) throw new Error("logsDir is required");
}

// РЕЭКСПОРТ ТИПОВ
export type { AccessLevelName } from "./types/config.types.js";
export type { PermissionRule } from "./defaults/perms.defaults.js";
export type { MainConfigData } from "./defaults/main.defaults.js";
export type { LogsConfigData } from "./defaults/logs.defaults.js";
export type { PermsConfigData } from "./defaults/perms.defaults.js";
export type { LogsConfig, LogCategories, ErrorHandlerSettings } from "./types/config.types.js";
export type { ConfigName, ConfigChangeEvent } from "@share/modules/configs/cfg.types.js";