// Share/core/functions/antiError.function.ts

import { Client, TextChannel, EmbedBuilder, codeBlock } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { logError, logWarn, logInfo } from './logSave.function.js';
// NOTE Вроде все работает, но нужно будет тестить и допиливать по ходу дела
// ═══════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════

export interface ErrorHandlerConfig {
  enabled: boolean;
  errorChannelId: string;
  crashLogsDir: string;
  maxStackLength: number;
  botName: string;
  ignorePatterns: RegExp[];
  sendWarnings: boolean;
  sendDelayMs: number;
  maxQueueSize: number;
}

interface ErrorPayload {
  type: 'unhandledRejection' | 'uncaughtException' | 'warning';
  error: Error | unknown;
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════
// СОСТОЯНИЕ
// ═══════════════════════════════════════════════════════════

let discordClient: Client | null = null;
let configGetter: (() => ErrorHandlerConfig) | null = null;

let isInitialized = false;
let errorQueue: ErrorPayload[] = [];
let isSending = false;

// ═══════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════

/**
 * Инициализация глобального обработчика ошибок.
 * Вызывать ОДИН раз при старте бота (ДО client.login).
 * 
 * @example
 * setupGlobalErrorHandler(() => ({
 *   botName: logsSettings.botName,
 *   errorChannelId: getErrorChannelId(),
 *   ignorePatterns: getIgnorePatterns(),
 *   ...ErrorHandlerCfg,
 * }));
 */
export function setupGlobalErrorHandler(dynamicConfigGetter: () => ErrorHandlerConfig): void {
  if (isInitialized) {
    logWarn('ANTI-ERROR', 'Обработчик уже инициализирован');
    return;
  }

  configGetter = dynamicConfigGetter;

  // Проверка и создание папки при первом запуске
  try {
    const cfg = configGetter();
    if (cfg.crashLogsDir) ensureDir(cfg.crashLogsDir);
  } catch (err) {
    logWarn('ANTI-ERROR', `Не удалось создать папку для логов при старте: ${err}`);
  }

  // ═══════════════════════════════════════════════════════
  // ОБРАБОТЧИКИ
  // ═══════════════════════════════════════════════════════

  process.on('unhandledRejection', (reason: unknown) => {
    handleError({ type: 'unhandledRejection', error: reason, timestamp: new Date() });
  });

  process.on('uncaughtException', (error: Error) => {
    handleError({ type: 'uncaughtException', error, timestamp: new Date() });
  });

  process.on('warning', (warning: Error) => {
    const cfg = getConfig();
    
    // Логируем всегда
    logWarn('NODE-WARNING', `${warning.name}: ${warning.message}`);
    if (warning.stack) logWarn('NODE-WARNING', warning.stack);

    // Отправляем в Discord если включено
    if (cfg.sendWarnings) {
      handleError({ type: 'warning', error: warning, timestamp: new Date() });
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  isInitialized = true;
}

/**
 * Привязать Discord клиент (вызывать после client.login или в ready)
 */
export function setErrorHandlerClient(client: Client): void {
  discordClient = client;
  // Отправляем накопившиеся ошибки
  processQueue();
}

// ═══════════════════════════════════════════════════════════
// ПОЛУЧЕНИЕ АКТУАЛЬНОГО КОНФИГА
// ═══════════════════════════════════════════════════════════

function getConfig(): ErrorHandlerConfig {
  if (!configGetter) {
    throw new Error("[ANTI-ERROR] Конфиг не задан! Сначала вызовите setupGlobalErrorHandler()");
  }
  return configGetter();
}

// ═══════════════════════════════════════════════════════════
// CORE LOGIC
// ═══════════════════════════════════════════════════════════

function handleError(payload: ErrorPayload): void {
  let cfg: ErrorHandlerConfig;
  try {
    cfg = getConfig();
  } catch (err) {
    console.error("[ANTI-ERROR FATAL]", payload.error);
    return;
  }
  
  if (!cfg.enabled) return;

  const { type, error, timestamp } = payload;
  const err = normalizeError(error);
  
  if (shouldIgnore(err, cfg.ignorePatterns)) return;

  const errorMessage = err.message || 'Unknown error';
  const errorStack = err.stack || 'No stack trace';

  // 1️⃣ Логируем в консоль
  logError('CRASH-PREVENT', `[${type}] ${errorMessage}`);
  logError('CRASH-PREVENT', errorStack);

  // 2️⃣ Сохраняем в файл
  saveCrashLog(type, err, timestamp, cfg);

  // 3️⃣ Добавляем в очередь для Discord
  if (errorQueue.length < cfg.maxQueueSize) {
    errorQueue.push(payload);
    processQueue();
  } else {
    logWarn('ANTI-ERROR', '⚠️ Очередь ошибок переполнена, пропускаем');
  }
}

async function processQueue(): Promise<void> {
  if (isSending || errorQueue.length === 0 || !discordClient?.isReady()) return;

  const cfg = getConfig();
  if (!cfg.errorChannelId) return;

  isSending = true;

  try {
    const channel = await discordClient.channels.fetch(cfg.errorChannelId);
    
    if (!channel || !channel.isTextBased()) {
      logWarn('ANTI-ERROR', `Канал ${cfg.errorChannelId} не найден или не текстовый`);
      isSending = false;
      return;
    }

    while (errorQueue.length > 0) {
      const payload = errorQueue.shift()!;
      try {
        await sendErrorToDiscord(channel as TextChannel, payload, cfg);
        await sleep(cfg.sendDelayMs);
      } catch (sendErr) {
        logError('ANTI-ERROR', `Не удалось отправить ошибку в Discord: ${sendErr}`);
      }
    }
  } catch (err) {
    logError('ANTI-ERROR', `Ошибка при обработке очереди: ${err}`);
  } finally {
    isSending = false;
  }
}

async function sendErrorToDiscord(
  channel: TextChannel, 
  payload: ErrorPayload,
  cfg: ErrorHandlerConfig
): Promise<void> {
  const { type, error, timestamp } = payload;
  const err = normalizeError(error);

  const typeLabels: Record<ErrorPayload['type'], string> = {
    unhandledRejection: '🔴 Unhandled Promise Rejection',
    uncaughtException: '💥 Uncaught Exception',
    warning: '⚠️ Warning',
  };

  const typeColors: Record<ErrorPayload['type'], number> = {
    unhandledRejection: 0xFF6B6B,
    uncaughtException: 0xFF0000,
    warning: 0xFFAA00,
  };

  let stack = err.stack || 'No stack trace';
  if (stack.length > cfg.maxStackLength) {
    stack = stack.substring(0, cfg.maxStackLength) + '\n... (truncated)';
  }

  const embed = new EmbedBuilder()
    .setTitle(typeLabels[type])
    .setColor(typeColors[type])
    .setDescription(`**Бот:** \`${cfg.botName}\``)
    .addFields(
      { name: '📛 Ошибка', value: codeBlock(truncate(err.message || 'Unknown', 1000)) },
      { name: '📚 Stack Trace', value: codeBlock('ts', stack) }
    )
    .setTimestamp(timestamp)
    .setFooter({ text: `PID: ${process.pid} | Node: ${process.version}` });

  await channel.send({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════
// CRASH LOG FILES
// ═══════════════════════════════════════════════════════════

function saveCrashLog(type: string, error: Error, timestamp: Date, cfg: ErrorHandlerConfig): void {
  if (!cfg.crashLogsDir) return;

  try {
    ensureDir(cfg.crashLogsDir);
    const dateStr = formatDate(timestamp);
    const filename = `crash_${dateStr}_${type}.log`;
    const filepath = path.join(cfg.crashLogsDir, filename);

    const content = [
      `═══════════════════════════════════════════════════════`,
      `CRASH REPORT — ${cfg.botName}`,
      `═══════════════════════════════════════════════════════`,
      ``,
      `Type:      ${type}`,
      `Timestamp: ${timestamp.toISOString()}`,
      `Process:   ${process.pid}`,
      `Node:      ${process.version}`,
      `Platform:  ${process.platform} ${process.arch}`,
      `Memory:    ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      `Uptime:    ${Math.round(process.uptime())}s`,
      ``,
      `═══════════════════════════════════════════════════════`,
      `ERROR MESSAGE`,
      `═══════════════════════════════════════════════════════`,
      ``,
      error.message || 'Unknown error',
      ``,
      `═══════════════════════════════════════════════════════`,
      `STACK TRACE`,
      `═══════════════════════════════════════════════════════`,
      ``,
      error.stack || 'No stack trace available',
      ``,
    ].join('\n');

    fs.appendFileSync(filepath, content + '\n\n');
  } catch (err) {
    console.error('[ANTI-ERROR] Не удалось сохранить crash log:', err);
  }
}

// ═══════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════

async function gracefulShutdown(signal: string): Promise<void> {
  logWarn('SHUTDOWN', `⚡ Получен сигнал ${signal}, завершаем работу...`);
  try {
    await sleep(1000); // Даём время на отправку последних ошибок
    if (discordClient) discordClient.destroy();
    logWarn('SHUTDOWN', '✅ Бот корректно завершил работу');
  } catch (err) {
    logError('SHUTDOWN', `Ошибка при завершении: ${err}`);
  }
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    const err = new Error(String(obj.message || obj.reason || JSON.stringify(error)));
    if (obj.stack) err.stack = String(obj.stack);
    return err;
  }
  return new Error(String(error));
}

function shouldIgnore(error: Error, patterns: RegExp[]): boolean {
  const combined = (error.message || '') + (error.stack || '');
  return patterns.some(pattern => pattern.test(combined));
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function formatDate(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════
// ПУБЛИЧНОЕ API
// ═══════════════════════════════════════════════════════════

export async function reportError(error: unknown, context?: string): Promise<void> {
  const err = normalizeError(error);
  if (context) err.message = `[${context}] ${err.message}`;
  handleError({ type: 'uncaughtException', error: err, timestamp: new Date() });
}

export function safeAsync<T extends (...args: any[]) => Promise<any>>(fn: T, context?: string): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      await reportError(error, context);
      throw error;
    }
  }) as T;
}

export function getErrorHandlerStatus(): {
  initialized: boolean;
  clientReady: boolean;
  queueSize: number;
  config: ErrorHandlerConfig | null;
} {
  let cfg = null;
  try { cfg = getConfig(); } catch { /* ignore */ }

  return {
    initialized: isInitialized,
    clientReady: discordClient?.isReady() ?? false,
    queueSize: errorQueue.length,
    config: cfg,
  };
}