// Share/modules/configs/cfg.types.ts
// ═══════════════════════════════════════════════════════════
// ТИПЫ СИСТЕМЫ КОНФИГУРАЦИИ
// ═══════════════════════════════════════════════════════════

import type { FSWatcher } from "fs";

/**
 * Имя конфиг-файла
 */
export type ConfigName = "main" | "logs" | "perms";

/**
 * Описание одного конфиг-файла для регистрации
 */
export interface ConfigFileDescriptor<T = unknown> {
  name: ConfigName;
  defaults: T;
  yamlPath: string;
  validate?: (data: T) => ValidationResult;
  transform?: (raw: Record<string, unknown>) => T;
}

/**
 * Результат валидации
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

/**
 * Состояние загруженного конфига
 */
export interface ConfigState<T = unknown> {
  name: ConfigName;
  data: T;
  yamlPath: string;
  defaults: T;
  generated: boolean;
  loadedAt: Date;
  watcher: FSWatcher | null;
  validate?: (data: T) => ValidationResult;
  transform?: (raw: Record<string, unknown>) => T;
}

/**
 * Опции инициализации ConfigManager
 */
export interface ConfigManagerOptions {
  configDir: string;
  hotReload?: boolean;
  hotReloadDebounce?: number;
  verbose?: boolean;
}

/**
 * Интерфейс для env-подстановки
 */
export interface EnvSubstitution {
  variable: string;
  defaultValue?: string;
  fullMatch: string;
}

/**
 * Событие изменения конфига
 */
export interface ConfigChangeEvent<T = unknown> {
  name: ConfigName;
  oldData: T;
  newData: T;
  timestamp: Date;
}

/**
 * Callback для подписки на изменения
 */
export type ConfigChangeListener<T = unknown> = (event: ConfigChangeEvent<T>) => void;

/**
 * Правило валидации для одного поля
 */
export interface FieldRule {
  type: "string" | "number" | "boolean" | "array" | "object";
  required?: boolean;
  pattern?: RegExp;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  enum?: readonly unknown[];
  description?: string;
}

/**
 * Схема валидации — через interface вместо type alias (избегаем circular reference)
 */
export interface ValidationSchema {
  [key: string]: FieldRule | ValidationSchema;
}