import kleur from "kleur";
import moment from "moment-timezone";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import { pipeline } from "stream/promises";
import { getBotPaths } from "@share/constants.js";
// ═══════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SILENT";

export interface LogSaveConfig {
  botName?: string;
  timezone?: string;
  dateFormat?: string;
  fileDateFormat?: string;
  logsDir?: string;
  archiveDir?: string;
  maxFileSizeMB?: number;
  keepArchiveDays?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  compressionLevel?: number;
  interceptConsole?: boolean;
  includeStackTrace?: boolean;
  jsonMaxDepth?: number;
  minLevel?: LogLevel;
  mode?: string;
  categories?: Record<string, boolean>;
  enabledLevels?: {
    info: boolean;
    error: boolean;
    warn: boolean;
  };
}

const LevelPriority: Record<LogLevel, number> = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SILENT: 99,
};

// ═══════════════════════════════════════════════════════════
// ЦВЕТОВАЯ СХЕМА
// Готова к кастомизации через конфиг в будущем.
// ═══════════════════════════════════════════════════════════

/**c
 * Схема цветов для одного уровня логирования.
 * В будущем можно будет менять через конфиг/API.
 */
export interface LevelColorScheme {
  /** Фон имени бота */
  name: (s: string) => string;
  /** Цвет тега [TAG] */
  tag: (s: string) => string;
  /** Цвет текста сообщения */
  msg: (s: string) => string;
}

/**
 * Цветовые схемы по уровням.
 * Можно расширять: LEVEL_COLORS["CUSTOM"] = { ... }
 */
export const LEVEL_COLORS: Record<string, LevelColorScheme> = {
  INFO: {
    name: (s) => kleur.bgWhite().black(s),
    tag:  (s) => kleur.green(s),
    msg:  (s) => kleur.white(s),
  },
  ERROR: {
    name: (s) => kleur.bgRed().white(s),
    tag:  (s) => kleur.red(s),
    msg:  (s) => kleur.red(s),
  },
  WARN: {
    name: (s) => kleur.bgYellow().black(s),
    tag:  (s) => kleur.yellow(s),
    msg:  (s) => kleur.yellow(s),
  },
  SUCCESS: {
    name: (s) => kleur.bgGreen().black(s),
    tag:  (s) => kleur.green(s),
    msg:  (s) => kleur.green(s),
  },
  DEBUG: {
    name: (s) => kleur.bgMagenta().white(s),
    tag:  (s) => kleur.magenta(s),
    msg:  (s) => kleur.magenta(s),
  },
};

/**
 * Установить кастомную цветовую схему для уровня.
 * Подготовка для будущей фичи с палитрами.
 */
export function setLevelColors(level: string, scheme: LevelColorScheme): void {
  LEVEL_COLORS[level] = scheme;
}

// ═══════════════════════════════════════════════════════════
// СОСТОЯНИЕ
// ═══════════════════════════════════════════════════════════

let config = {
  botName: process.env.INSCRIPTION || "BOT",
  timezone: "Europe/Moscow",
  dateFormat: "DD.MM.YYYY HH:mm:ss",
  fileDateFormat: "YYYY-MM-DD_HH-mm-ss",
  logsDir: "",
  archiveDir: "",
  maxFileSizeMB: 10,
  keepArchiveDays: 10,
  flushIntervalMs: 5000,
  maxBufferSize: 50,
  compressionLevel: 6,
  interceptConsole: true,
  includeStackTrace: true,
  jsonMaxDepth: 3,
  minLevel: "INFO" as LogLevel,
  mode: "production",
  categories: {} as Record<string, boolean>,
  enabledLevels: { info: true, error: true, warn: true },
};

let latestLogPath = "";
let fileLoggingEnabled = false;
let isInitialized = false;
let flushInterval: NodeJS.Timeout | null = null;
let flushErrorCount = 0;

const logBuffer = { lines: [] as string[], size: 0 };

const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};

// ═══════════════════════════════════════════════════════════
// ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════

function getTimestamp(): string {
  return moment().tz(config.timezone).format(config.dateFormat);
}

export function isCategoryEnabled(category: string): boolean {
  return config.categories[category] ?? true;
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LevelPriority[level] >= LevelPriority[config.minLevel];
}

// ═══════════════════════════════════════════════════════════
// ЕДИНЫЙ ФОРМАТТЕР
//
// Формат: ` BOT | DD.MM.YYYY HH:mm:ss | [TAG] - message`
// 
// Все log-функции делегируют сюда — ОДИН источник правды
// для формата, цветов и записи в буфер.
// ═══════════════════════════════════════════════════════════

function printLog(
  level: string,
  bufferLevel: string,
  tag: string,
  message: string,
): void {
  const colors = LEVEL_COLORS[level] || LEVEL_COLORS.INFO;
  const ts = getTimestamp();
  const sep = kleur.gray(" | ");

  // Единая строка — точный контроль пробелов (без артефактов console.log)
  const line = [
    colors.name(` ${config.botName} `),
    sep,
    kleur.yellow(ts),
    sep,
    colors.tag(`[${tag}]`),
    kleur.gray(" - "),
    colors.msg(message),
  ].join("");

  originalConsole.log(line);
  addToBuffer(bufferLevel, tag, message);
}

// ═══════════════════════════════════════════════════════════
// КОНСОЛЬНЫЕ ЛОГИ
// ═══════════════════════════════════════════════════════════



/** INFO уровень — основной лог */
export function logInfo(tag: string, message: string, category?: string): void {
  if (!isLevelEnabled("INFO")) return;
  if (category && !isCategoryEnabled(category)) return;
  printLog("INFO", "INFO", tag, message);
}

/** ERROR уровень */
export function logError(tag: string, message: string, category?: string): void {
  if (!isLevelEnabled("ERROR")) return;
  if (category && !isCategoryEnabled(category)) return;
  printLog("ERROR", "ERROR", tag, message);
}

/** WARN уровень */
export function logWarn(tag: string, message: string, category?: string): void {
  if (!isLevelEnabled("WARN")) return;
  if (category && !isCategoryEnabled(category)) return;
  printLog("WARN", "WARN", tag, message);
}

/** SUCCESS — визуальный вариант INFO с ✅ */
export function logSuccess(tag: string, message: string, category?: string): void {
  if (!isLevelEnabled("INFO")) return;
  if (category && !isCategoryEnabled(category)) return;
  printLog("SUCCESS", "INFO", tag, message);
}

/** DEBUG уровень */
export function logDebug(tag: string, message: string, category?: string): void {
  if (!isLevelEnabled("DEBUG")) return;
  if (category && !isCategoryEnabled(category)) return;
  printLog("DEBUG", "DEBUG", tag, message);
}

/** Загрузка списка — делегирует в logInfo */
export function logLoaded(
  tag: string,
  items: string[],
  showNames: boolean = false,
  category?: string,
): void {
  if (items.length === 0) return;
  let msg = `Загружено: ${items.length}`;
  if (showNames && items.length <= 10) msg += ` (${items.join(", ")})`;
  logInfo(tag, msg, category);
}

// ═══════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ (файловое логирование)
// ═══════════════════════════════════════════════════════════

/**
 * Инициализирует систему логирования.
 * - Консольные логи (logInfo, logError, ...) работают и БЕЗ вызова этой функции.
 * - initLogSave() добавляет файловое сохранение, ротацию, архивацию.
 */
export async function initLogSave(
  customConfig?: Partial<LogSaveConfig> | any,
): Promise<void> {
  if (isInitialized) return;

  // Применяем пользовательский конфиг
  if (customConfig) {
    const c = customConfig;
    config = {
      ...config,
      botName: c.botName ?? config.botName,
      timezone: c.timezone ?? config.timezone,
      dateFormat: c.dateFormat ?? config.dateFormat,
      fileDateFormat: c.fileDateFormat ?? config.fileDateFormat,
      logsDir: c.logsDir ?? config.logsDir,
      archiveDir: c.archiveDir ?? config.archiveDir,
      maxFileSizeMB: c.maxFileSizeMB ?? config.maxFileSizeMB,
      keepArchiveDays: c.keepArchiveDays ?? config.keepArchiveDays,
      flushIntervalMs: c.flushIntervalMs ?? config.flushIntervalMs,
      maxBufferSize: c.maxBufferSize ?? config.maxBufferSize,
      compressionLevel: c.compressionLevel ?? config.compressionLevel,
      interceptConsole: c.interceptConsole ?? config.interceptConsole,
      includeStackTrace: c.includeStackTrace ?? config.includeStackTrace,
      jsonMaxDepth: c.jsonMaxDepth ?? config.jsonMaxDepth,
      minLevel: c.minLevel ?? config.minLevel,
      mode: c.mode ?? config.mode,
      categories: c.categories
        ? { ...config.categories, ...readCategories(c.categories) }
        : config.categories,
      enabledLevels: c.enabledLevels
        ? { ...config.enabledLevels, ...c.enabledLevels }
        : config.enabledLevels,
    };
  }
  if (!config.logsDir) {
    try {
      const paths = getBotPaths();
      config.logsDir = paths.logs;
      config.archiveDir = paths.archive;
    } catch {
      // BotPaths не инициализирован — файловое логирование отключено
    }
  }
  if (!config.archiveDir && config.logsDir) {
    config.archiveDir = path.join(config.logsDir, "archive");
  }

  // Если после всех попыток путей нет — только консоль
  if (!config.logsDir) {
    isInitialized = true;
    return;
  }

  try {
    await fsp.mkdir(config.logsDir, { recursive: true });
    if (config.archiveDir) await fsp.mkdir(config.archiveDir, { recursive: true });
  } catch (err) {
    originalConsole.error("⚠️ Не удалось создать директории логов:", (err as Error).message);
    originalConsole.warn("⚠️ Файловое логирование отключено, бот продолжает работу");
    isInitialized = true;
    return;
  }

  await archivePreviousLatest();

  try {
    await createLatestLog();
    fileLoggingEnabled = true;
  } catch (err) {
    originalConsole.error("⚠️ Не удалось создать latest.log:", (err as Error).message);
    isInitialized = true;
    return;
  }

  if (config.interceptConsole) interceptConsole();

  startFlushInterval();
  cleanupOldArchives().catch(() => {});

  isInitialized = true;

  originalConsole.log(`📁 Логи: ${latestLogPath}`);
  originalConsole.log(`📦 Архивы: ${config.archiveDir}`);
  originalConsole.log(`⏰ Хранение архивов: ${config.keepArchiveDays} дней`);
}

function readCategories(cats: any): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  try {
    const keys = Object.keys(cats);
    for (const k of keys) result[k] = !!cats[k];
  } catch { /* proxy может не поддерживать keys */ }
  return result;
}

// ═══════════════════════════════════════════════════════════
// БУФЕРИЗАЦИЯ И ЗАПИСЬ В ФАЙЛ
// ═══════════════════════════════════════════════════════════

function addToBuffer(level: string, tag: string, message: string): void {
  if (!fileLoggingEnabled) return;

  const timestamp = moment().tz(config.timezone).format(config.dateFormat);
  const line = `[${timestamp}] [${level}] [${tag}] ${stripAnsi(message)}\n`;

  logBuffer.lines.push(line);
  logBuffer.size++;

  if (logBuffer.size >= config.maxBufferSize) flushBuffer();
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

function flushBuffer(): void {
  if (logBuffer.lines.length === 0 || !latestLogPath) return;
  if (!fileLoggingEnabled) {
    logBuffer.lines = [];
    logBuffer.size = 0;
    return;
  }

  const content = logBuffer.lines.join("");
  logBuffer.lines = [];
  logBuffer.size = 0;

  fsp.appendFile(latestLogPath, content, "utf-8")
    .then(() => { flushErrorCount = 0; return checkFileSize(); })
    .catch((err) => {
      flushErrorCount++;
      if (flushErrorCount >= 3) {
        originalConsole.error("⚠️ 3+ ошибки записи лога, отключаю файловое логирование");
        fileLoggingEnabled = false;
      } else {
        originalConsole.error("⚠️ Ошибка записи лога:", (err as Error).message);
      }
    });
}

function startFlushInterval(): void {
  if (flushInterval) clearInterval(flushInterval);
  flushInterval = setInterval(() => flushBuffer(), config.flushIntervalMs);
  flushInterval.unref();
}

// ═══════════════════════════════════════════════════════════
// АРХИВИРОВАНИЕ И РОТАЦИЯ
// ═══════════════════════════════════════════════════════════

async function archivePreviousLatest(): Promise<void> {
  latestLogPath = path.join(config.logsDir, "latest.log");

  try {
    const stats = await fsp.stat(latestLogPath);
    if (stats.size === 0) {
      await fsp.unlink(latestLogPath).catch(() => {});
      return;
    }

    const fileDate = moment(stats.mtime).tz(config.timezone);
    const archiveName = `${config.botName}_${fileDate.format(config.fileDateFormat)}.log.gz`;
    let archivePath = path.join(config.archiveDir, archiveName);

    try {
      await fsp.stat(archivePath);
      const uniqueName = archiveName.replace(".log.gz", `_${process.pid}.log.gz`);
      archivePath = path.join(config.archiveDir, uniqueName);
      originalConsole.log(`📦 Архивирую предыдущий latest.log → ${uniqueName}`);
    } catch {
      originalConsole.log(`📦 Архивирую предыдущий latest.log → ${archiveName}`);
    }

    const source = fs.createReadStream(latestLogPath);
    const destination = fs.createWriteStream(archivePath);
    const gzip = zlib.createGzip({ level: config.compressionLevel });

    await pipeline(source, gzip, destination);
    await fsp.unlink(latestLogPath);
    originalConsole.log(`✅ Архивировано: ${path.basename(archivePath)}`);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    if (code === "EACCES" || code === "EBUSY" || code === "EPERM") {
      originalConsole.warn("⚠️ latest.log залочен, пропускаю архивацию");
      await new Promise(r => setTimeout(r, 1000));
      await fsp.unlink(latestLogPath).catch(() => {});
      return;
    }
    originalConsole.error("⚠️ Ошибка архивирования:", (err as Error).message);
    await fsp.unlink(latestLogPath).catch(() => {});
  }
}

async function createLatestLog(): Promise<void> {
  latestLogPath = path.join(config.logsDir, "latest.log");
  const now = moment().tz(config.timezone);
  const header = [
    "═".repeat(60),
    `📋 ${config.botName.toUpperCase()} LOG`,
    `📅 Started: ${now.format(config.dateFormat)}`,
    `🖥️  PID: ${process.pid}`,
    `📍 Node: ${process.version}`,
    `⚙️  MaxSize: ${config.maxFileSizeMB}MB | KeepArchive: ${config.keepArchiveDays}d`,
    "═".repeat(60),
    "",
  ].join("\n");
  await fsp.writeFile(latestLogPath, header, "utf-8");
}

async function checkFileSize(): Promise<void> {
  if (!latestLogPath) return;
  try {
    const stats = await fsp.stat(latestLogPath);
    if (stats.size / (1024 * 1024) >= config.maxFileSizeMB) {
      await rotateLatestLog();
    }
  } catch { /* ignore */ }
}

async function rotateLatestLog(): Promise<void> {
  const timestamp = moment().tz(config.timezone).format(config.fileDateFormat);
  const archiveName = `${config.botName}_${timestamp}.log.gz`;
  const archivePath = path.join(config.archiveDir, archiveName);

  originalConsole.log(`📦 Ротация: latest.log → ${archiveName}`);

  try {
    const source = fs.createReadStream(latestLogPath);
    const destination = fs.createWriteStream(archivePath);
    const gzip = zlib.createGzip({ level: config.compressionLevel });
    await pipeline(source, gzip, destination);

    const header = [
      "═".repeat(60),
      `📋 ${config.botName.toUpperCase()} LOG (continued)`,
      `📅 Continued: ${moment().tz(config.timezone).format(config.dateFormat)}`,
      `📄 Previous: ${archiveName}`,
      "═".repeat(60),
      "",
    ].join("\n");
    await fsp.writeFile(latestLogPath, header, "utf-8");
  } catch (err) {
    originalConsole.error("⚠️ Ошибка ротации:", (err as Error).message);
  }
}

async function cleanupOldArchives(): Promise<void> {
  try {
    const files = await fsp.readdir(config.archiveDir);
    const now = Date.now();
    const maxAgeMs = config.keepArchiveDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    await Promise.allSettled(
      files.filter(f => f.endsWith(".gz")).map(async (file) => {
        const filePath = path.join(config.archiveDir, file);
        const stats = await fsp.stat(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fsp.unlink(filePath);
          deleted++;
        }
      })
    );

    if (deleted > 0) originalConsole.log(`🧹 Очищено ${deleted} старых архивов`);
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════
// ПЕРЕХВАТ CONSOLE (для записи в файл)
// ═══════════════════════════════════════════════════════════

function interceptConsole(): void {
  if (config.enabledLevels.info) {
    console.log = (...args: unknown[]) => {
      originalConsole.log(...args);
      addToBufferRaw("INFO", args);
    };
  }
  if (config.enabledLevels.error) {
    console.error = (...args: unknown[]) => {
      originalConsole.error(...args);
      addToBufferRaw("ERROR", args);
    };
  }
  if (config.enabledLevels.warn) {
    console.warn = (...args: unknown[]) => {
      originalConsole.warn(...args);
      addToBufferRaw("WARN", args);
    };
  }
}

function addToBufferRaw(level: string, args: unknown[]): void {
  if (!fileLoggingEnabled) return;
  const timestamp = moment().tz(config.timezone).format(config.dateFormat);
  const message = args.map(a => {
    if (typeof a === "string") return stripAnsi(a);
    if (a instanceof Error) return config.includeStackTrace && a.stack ? `${a.message}\n${a.stack}` : a.message;
    if (typeof a === "object" && a !== null) {
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    }
    return String(a);
  }).join(" ");

  const line = `[${timestamp}] [${level}] ${message}\n`;
  logBuffer.lines.push(line);
  logBuffer.size++;
  if (logBuffer.size >= config.maxBufferSize) flushBuffer();
}

// ═══════════════════════════════════════════════════════════
// ПУБЛИЧНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════

export function flush(): void { flushBuffer(); }

export async function shutdown(): Promise<void> {
  if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
  flushBuffer();
  await new Promise(r => setTimeout(r, 100));
}

export function getLatestLogPath(): string { return latestLogPath; }
export function isReady(): boolean { return isInitialized; }

// ═══════════════════════════════════════════════════════════
// ОБРАБОТКА ЗАВЕРШЕНИЯ
// ═══════════════════════════════════════════════════════════

process.on("beforeExit", flush);