// Share/modules/configs/cfg.manager.ts
// ═══════════════════════════════════════════════════════════
// ГЛАВНЫЙ МЕНЕДЖЕР КОНФИГУРАЦИИ
// ═══════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import * as log from "@share/core/decorators/logger.decorator.js";
import type {
  ConfigName,
  ConfigFileDescriptor,
  ConfigState,
  ConfigManagerOptions,
  ConfigChangeEvent,
  ConfigChangeListener,
  ValidationResult,
} from "./cfg.types.js";
import { generateYamlFile, forceRegenerateYamlFile } from "./cfg.generator.js";
import { safeReadYamlFile, deepMergeWithDefaults } from "./cfg.reader.js";
import { validateStructure, formatValidationResult } from "./cfg.validator.js";

// ═══════════════════════════════════════════════════════════
// КЛАСС ConfigManager
// ═══════════════════════════════════════════════════════════

export class ConfigManager {
  private configs: Map<ConfigName, ConfigState> = new Map();
  private listeners: Map<ConfigName, Set<ConfigChangeListener>> = new Map();
  private globalListeners: Set<ConfigChangeListener> = new Set();
  private options: Required<ConfigManagerOptions>;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: ConfigManagerOptions) {
    this.options = {
      configDir: options.configDir,
      hotReload: options.hotReload ?? true,
      hotReloadDebounce: options.hotReloadDebounce ?? 1000,
      verbose: options.verbose ?? true,
    };

    if (!fs.existsSync(this.options.configDir)) {
      fs.mkdirSync(this.options.configDir, { recursive: true });
      log.logInfo("📁 Создана директория конфигов:", this.options.configDir);
    }
  }
  register<T>(descriptor: ConfigFileDescriptor<T>): T {
    const { name, defaults, validate, transform } = descriptor;

    const yamlPath =
      descriptor.yamlPath ||
      path.join(this.options.configDir, `cfg.${name}.yaml`);

    log.logDebug("CFG",`📋 Регистрация конфига: ${name} → ${path.basename(yamlPath)}`);

    // Шаг 1: Генерация YAML если не существует
    const wasGenerated = generateYamlFile(
      yamlPath,
      defaults as Record<string, unknown>,
      this.getHeaderForConfig(name)
    );

    if (wasGenerated) {
      log.logDebug("CFG", `✨ Сгенерирован: ${path.basename(yamlPath)} (из дефолтов)`);
    }

    // Шаг 2: Чтение YAML
    const { data: rawData, error } = safeReadYamlFile<Record<string, unknown>>(
      yamlPath,
      this.options.verbose
    );

    if (error || !rawData) {
      log.logWarn("CONFIG", `Не удалось прочитать ${path.basename(yamlPath)}, используем дефолты`);
      return this.storeConfig(name, defaults, yamlPath, true, validate, transform);
    }

    // Шаг 3: Трансформация
    let processedData: Record<string, unknown>;
    if (transform) {
      try {
        processedData = transform(rawData) as unknown as Record<string, unknown>;
      } catch (err) {
        log.logWarn("CONFIG", `Ошибка трансформации ${name}: ${err instanceof Error ? err.message : err}`);
        processedData = rawData;
      }
    } else {
      processedData = rawData;
    }

    // Шаг 4: Проверка структуры и слияние
    const defaultsAsRecord = defaults as unknown as Record<string, unknown>;

    const structCheck = validateStructure(processedData, defaultsAsRecord);

    if (structCheck.missing.length > 0) {
      log.logWarn("CONFIG", `В ${path.basename(yamlPath)} отсутствуют ключи (будут взяты из дефолтов):\n` +
        structCheck.missing.map((k) => `  • ${k}`).join("\n"));
    }

    if (structCheck.extra.length > 0 && this.options.verbose) {
      log.logInfo("CONFIG", `ℹ️ В ${path.basename(yamlPath)} найдены лишние ключи (игнорируются):\n` +
        structCheck.extra.map((k) => `  • ${k}`).join("\n"));
    }

    const merged = deepMergeWithDefaults(
      processedData,
      defaultsAsRecord
    ) as unknown as T;

    // Шаг 5: Валидация
    if (validate) {
      const validationResult = validate(merged);
      if (!validationResult.valid) {
        log.logError("CONFIG", `❌ Валидация ${name} не пройдена:\n${formatValidationResult(validationResult)}`);
        log.logWarn("CONFIG", `Используем дефолты для ${name} из-за ошибок валидации`);
        return this.storeConfig(name, defaults, yamlPath, false, validate, transform);
      }
      if (validationResult.warnings.length > 0 && this.options.verbose) {
        log.logWarn("CONFIG", `⚠️ Валидация ${name} выдала предупреждения:\n${formatValidationResult(validationResult)}`);
      }
    }

    // Шаг 6: Сохраняем и ставим watcher
    return this.storeConfig(name, merged, yamlPath, wasGenerated, validate, transform);
  }

  // ═══════════════════════════════════════════════════════════
  // ДОСТУП К КОНФИГАМ
  // ═══════════════════════════════════════════════════════════

  get<T = unknown>(name: ConfigName): T {
    const state = this.configs.get(name);
    if (!state) {
      throw new Error(
        `[ConfigManager] Конфиг "${name}" не зарегистрирован. Вызовите register() сначала.`
      );
    }
    return state.data as T;
  }

  getPath<T = unknown>(name: ConfigName, dotPath: string): T {
    const data = this.get<Record<string, unknown>>(name);
    const keys = dotPath.split(".");
    let current: unknown = data;

    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== "object") {
        throw new Error(
          `[ConfigManager] Путь "${dotPath}" не найден в конфиге "${name}" (остановка на "${key}")`
        );
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current as T;
  }

  getPathSafe<T = unknown>(name: ConfigName, dotPath: string, fallback: T): T {
    try {
      const val = this.getPath<T>(name, dotPath);
      return val ?? fallback;
    } catch {
      return fallback;
    }
  }

  has(name: ConfigName): boolean {
    return this.configs.has(name);
  }

  getRegisteredNames(): ConfigName[] {
    return [...this.configs.keys()];
  }

  // ═══════════════════════════════════════════════════════════
  // HOT-RELOAD
  // ═══════════════════════════════════════════════════════════

  onChange<T = unknown>(
    name: ConfigName,
    listener: ConfigChangeListener<T>
  ): () => void {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }
    this.listeners.get(name)!.add(listener as ConfigChangeListener);
    return () => {
      this.listeners.get(name)?.delete(listener as ConfigChangeListener);
    };
  }

  onAnyChange(listener: ConfigChangeListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  reload(name: ConfigName): void {
    const state = this.configs.get(name);
    if (!state) {
      throw new Error(`[ConfigManager] Конфиг "${name}" не зарегистрирован`);
    }

    log.logDebug("CFG", `🔄 Перезагрузка конфига: ${name}`);

    const oldData = state.data;

    const { data: rawData, error } = safeReadYamlFile<Record<string, unknown>>(
      state.yamlPath,
      this.options.verbose
    );

    if (error || !rawData) {
      this.warn(`Не удалось перечитать ${name}, данные не изменены`);
      return;
    }

    let processedData: Record<string, unknown>;
    if (state.transform) {
      try {
        processedData = (state.transform as (raw: Record<string, unknown>) => unknown)(rawData) as Record<string, unknown>;
      } catch (err) {
        log.logError("CONFIG", `Ошибка трансформации ${name}: ${err instanceof Error ? err.message : err}`);
        processedData = rawData;
      }
    } else {
      processedData = rawData;
    }

    const merged = deepMergeWithDefaults(
      processedData,
      state.defaults as unknown as Record<string, unknown>
    );

    if (state.validate) {
      const result = (state.validate as (data: unknown) => ValidationResult)(merged);
      if (!result.valid) {
        this.warn(
          `Перезагрузка ${name} отменена — ошибки валидации:\n${formatValidationResult(result)}`
        );
        return;
      }
    }

    state.data = merged;
    state.loadedAt = new Date();

    log.logDebug("CFG", `✅ Конфиг ${name} перезагружен`);

    const event: ConfigChangeEvent = {
      name,
      oldData,
      newData: merged,
      timestamp: new Date(),
    };

    this.listeners.get(name)?.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        log.logError("CONFIG", `[ConfigManager] Ошибка в listener для ${name}: ${err instanceof Error ? err.message : err}`);
      }
    });

    this.globalListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        log.logError("CONFIG", `[ConfigManager] Ошибка в global listener: ${err instanceof Error ? err.message : err}`);
      }
    });
  }

  reloadAll(): void {
    for (const name of this.configs.keys()) {
      this.reload(name);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // СБРОС К ДЕФОЛТАМ
  // ═══════════════════════════════════════════════════════════

  resetToDefaults(name: ConfigName): void {
    const state = this.configs.get(name);
    if (!state) {
      throw new Error(`[ConfigManager] Конфиг "${name}" не зарегистрирован`);
    }

    log.logDebug("CFG", `🔃 Сброс конфига ${name} к дефолтам`);

    forceRegenerateYamlFile(
      state.yamlPath,
      state.defaults as unknown as Record<string, unknown>,
      this.getHeaderForConfig(name)
    );

    state.data = structuredClone(state.defaults);
    state.loadedAt = new Date();
    state.generated = true;
  }

  // ═══════════════════════════════════════════════════════════
  // УНИЧТОЖЕНИЕ
  // ═══════════════════════════════════════════════════════════

  destroy(): void {
    log.logDebug("CFG", "🧹 Уничтожение ConfigManager, очистка ресурсов");

    for (const state of this.configs.values()) {
      if (state.watcher) {
        state.watcher.close();
        state.watcher = null;
      }
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }

    this.debounceTimers.clear();
    this.listeners.clear();
    this.globalListeners.clear();
  }

  getStatus(): Record<string, unknown> {
    const configs: Record<string, unknown> = {};
    for (const [name, state] of this.configs) {
      configs[name] = {
        yamlPath: state.yamlPath,
        generated: state.generated,
        loadedAt: state.loadedAt.toISOString(),
        hasWatcher: state.watcher !== null,
        listenersCount: this.listeners.get(name)?.size ?? 0,
      };
    }

    return {
      configDir: this.options.configDir,
      hotReload: this.options.hotReload,
      registeredConfigs: this.configs.size,
      globalListeners: this.globalListeners.size,
      configs,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ПРИВАТНЫЕ МЕТОДЫ
  // ═══════════════════════════════════════════════════════════

  private storeConfig<T>(
    name: ConfigName,
    data: T,
    yamlPath: string,
    generated: boolean,
    validate?: (data: T) => ValidationResult,
    transform?: (raw: Record<string, unknown>) => T
  ): T {
    const existing = this.configs.get(name);
    if (existing?.watcher) {
      existing.watcher.close();
    }

    const state: ConfigState = {
      name,
      data,
      yamlPath,
      defaults: structuredClone(data),
      generated,
      loadedAt: new Date(),
      watcher: null,
      validate: validate as ((data: unknown) => ValidationResult) | undefined,
      transform: transform as ((raw: Record<string, unknown>) => unknown) | undefined,
    };

    if (this.options.hotReload) {
      state.watcher = this.createWatcher(name, yamlPath);
    }

    this.configs.set(name, state);

    return data;
  }

  private createWatcher(name: ConfigName, filePath: string): fs.FSWatcher | null {
    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType !== "change") return;

        const timerKey = `watch_${name}`;
        const existing = this.debounceTimers.get(timerKey);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
          timerKey,
          setTimeout(() => {
            log.logDebug("CFG", `🔥 Hot-reload: обнаружено изменение ${path.basename(filePath)}`);
            this.reload(name);
            this.debounceTimers.delete(timerKey);
          }, this.options.hotReloadDebounce)
        );
      });

      watcher.on("error", (err) => {
        log.logError("CONFIG", `Watcher ошибка для ${name}: ${err.message}`);
      });

      return watcher;
    } catch (err) {
      this.warn(
        `Не удалось создать watcher для ${name}: ${err instanceof Error ? err.message : err}`
      );
      return null;
    }
  }

  private getHeaderForConfig(name: ConfigName): string {
    const headers: Record<ConfigName, string> = {
      main: "MAIN CONFIGURATION — Server, Timings, Database",
      logs: "LOGGING CONFIGURATION — Console, Files, Archive",
      perms: "PERMISSIONS CONFIGURATION — Access Levels & Groups",
    };
    return headers[name] ?? `${name.toUpperCase()} CONFIGURATION`;
  }

  private log(message: string, ...args: unknown[]): void {
    if (this.options.verbose) {
      log.logDebug("CFG", `${message} ${args.map(a => JSON.stringify(a)).join(" ")}`);
    }
  }

  private warn(message: string): void {
    log.logWarn("CONFIG",`⚠️ ${message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════

let _instance: ConfigManager | null = null;

export function getConfigManager(options?: ConfigManagerOptions): ConfigManager {
  if (!_instance) {
    if (!options) {
      throw new Error(
        "[ConfigManager] Первый вызов getConfigManager() требует options"
      );
    }
    _instance = new ConfigManager(options);
  }
  return _instance;
}

export function destroyConfigManager(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}