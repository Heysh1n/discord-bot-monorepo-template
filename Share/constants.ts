import path from "path";

export const PROJECT_ROOT = process.cwd();

export function getToken(envKey: string): string {
  if (typeof envKey !== 'string' || !envKey.trim()) {
    throw new Error(`❌ Передан пустой/undefined ключ для токена!`);
  }

  const token = process.env[envKey];
  if (!token) throw new Error(`Токен ${envKey} отсутствует в .env`);
  return token;
}

/** 
 * Общие пути — только для Share модулей.
 * НЕ для данных ботов!
 */
export const SharedPaths = {
  root:  PROJECT_ROOT,
  share: path.join(PROJECT_ROOT, "Share"),
} as const;

/**
 * Пути конкретного бота.
 * 
 * Структура:
 *   _Template/
 *   ├── data/
 *   │   ├── configs/      ← YAML-конфиги
 *   │   ├── logs/         ← latest.log
 *   │   │   ├── archive/  ← .gz архивы
 *   │   │   └── crashes/  ← crash dumps
 *   │   ├── cache/        ← cache.json
 *   │   ├── database/     ← локальные JSON-базы
 *   │   └── activity/     ← activity.json
 *   └── src/              ← исходники бота
 */
export class BotPaths {
  readonly root:     string;
  readonly data:     string;
  readonly configs:  string;
  readonly logs:     string;
  readonly archive:  string;
  readonly crashes:  string;  // ✅ Добавлено
  readonly cache:    string;
  readonly localDB:  string;
  readonly activity: string;  // ✅ Добавлено
  readonly src:      string;

  constructor(botDirName: string) {
    this.root     = path.join(PROJECT_ROOT, botDirName);
    this.data     = path.join(this.root, "data");
    this.configs  = path.join(this.data, "configs");
    this.logs     = path.join(this.data, "logs");
    this.archive  = path.join(this.data, "logs", "archive");
    this.crashes  = path.join(this.data, "logs", "crashes");  // ✅
    this.cache    = path.join(this.data, "cache");
    this.localDB  = path.join(this.data, "database");
    this.activity = path.join(this.data, "activity");         // ✅
    this.src      = path.join(this.root, "src");
  }
}

// ─── Singleton текущего бота ──────────────────────────────

let _currentPaths: BotPaths | null = null;

export function initBotPaths(botDirName: string): BotPaths {
  _currentPaths = new BotPaths(botDirName);
  return _currentPaths;
}

export function getBotPaths(): BotPaths {
  if (!_currentPaths) {
    throw new Error(
      "[Paths] Не инициализировано! Вызови initBotPaths() в index.ts бота."
    );
  }
  return _currentPaths;
}


export const defaultColours = {
  defaultEmbed: 0xFFFFFF,     // Белый
  errorEmbed: 0xFF6B6B,    // Красный
  successEmbed: 0x57F287,  // Зелёный
  warnEmbed: 0xFFAA00,     // Оранжевый
  infoEmbed: 0x5865F2,     // Blurple
};

export const emojis = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
}


export const timeUnits = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
}
export const timeUnitNames = {
  second: "second",
  minute: "minute",
  hour: "hour",
  day: "day",
}
export const timeUnitNamesPlural = {
  second: "Seconds",
  minute: "Minutes",
  hour: "Hours",
  day: "Days",
}
export const timeUnitNamesPluralMany = {
  second: "seconds",
  minute: "minutes",
  hour: "hours",
  day: "days",
}


