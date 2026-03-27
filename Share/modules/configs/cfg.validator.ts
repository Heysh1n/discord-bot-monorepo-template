// Share/modules/configs/cfg.validator.ts
// ═══════════════════════════════════════════════════════════
// ВАЛИДАЦИЯ КОНФИГУРАЦИИ
// ═══════════════════════════════════════════════════════════

import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  FieldRule,
  ValidationSchema,
} from "./cfg.types.js";

// ═══════════════════════════════════════════════════════════
// ОСНОВНАЯ ВАЛИДАЦИЯ ПО СХЕМЕ
// ═══════════════════════════════════════════════════════════

/**
 * Валидирует объект данных по схеме
 */
export function validateBySchema(
  data: Record<string, unknown>,
  schema: ValidationSchema,
  basePath: string = ""
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const [key, ruleOrNested] of Object.entries(schema)) {
    const fullPath = basePath ? `${basePath}.${key}` : key;
    const value = data[key];

    // Если это вложенная схема (нет поля "type" на верхнем уровне)
    if (isNestedSchema(ruleOrNested)) {
      if (value === undefined || value === null) {
        errors.push({
          path: fullPath,
          message: `Отсутствует обязательная секция`,
          expected: "object",
          received: String(value),
        });
        continue;
      }

      if (typeof value !== "object" || Array.isArray(value)) {
        errors.push({
          path: fullPath,
          message: `Ожидался объект`,
          expected: "object",
          received: typeof value,
        });
        continue;
      }

      const nested = validateBySchema(
        value as Record<string, unknown>,
        ruleOrNested as ValidationSchema,
        fullPath
      );
      errors.push(...nested.errors);
      warnings.push(...nested.warnings);
      continue;
    }

    // Это правило для конкретного поля
    const rule = ruleOrNested as FieldRule;
    const fieldResult = validateField(value, rule, fullPath);
    errors.push(...fieldResult.errors);
    warnings.push(...fieldResult.warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════════════════════════
// ВАЛИДАЦИЯ ОДНОГО ПОЛЯ
// ═══════════════════════════════════════════════════════════

function validateField(
  value: unknown,
  rule: FieldRule,
  path: string
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const desc = rule.description ? ` (${rule.description})` : "";

  // Проверка обязательности
  if (value === undefined || value === null) {
    if (rule.required !== false) {
      errors.push({
        path,
        message: `Отсутствует обязательное поле${desc}`,
        expected: rule.type,
        received: String(value),
      });
    }
    return { errors, warnings };
  }

  // Проверка типа
  const actualType = Array.isArray(value) ? "array" : typeof value;
  if (actualType !== rule.type) {
    errors.push({
      path,
      message: `Неверный тип${desc}`,
      expected: rule.type,
      received: actualType,
    });
    return { errors, warnings };
  }

  // Проверки для string
  if (rule.type === "string" && typeof value === "string") {
    if (rule.pattern && !rule.pattern.test(value)) {
      errors.push({
        path,
        message: `Не соответствует паттерну ${rule.pattern}${desc}`,
        expected: `match ${rule.pattern}`,
        received: value,
      });
    }
    if (rule.minLength !== undefined && value.length < rule.minLength) {
      errors.push({
        path,
        message: `Длина строки меньше ${rule.minLength}${desc}`,
        expected: `>= ${rule.minLength} символов`,
        received: `${value.length} символов`,
      });
    }
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      warnings.push({
        path,
        message: `Длина строки больше ${rule.maxLength}${desc}`,
      });
    }
  }

  // Проверки для number
  if (rule.type === "number" && typeof value === "number") {
    if (Number.isNaN(value)) {
      errors.push({
        path,
        message: `Значение NaN${desc}`,
        expected: "число",
        received: "NaN",
      });
    }
    if (rule.min !== undefined && value < rule.min) {
      errors.push({
        path,
        message: `Значение меньше минимума${desc}`,
        expected: `>= ${rule.min}`,
        received: String(value),
      });
    }
    if (rule.max !== undefined && value > rule.max) {
      errors.push({
        path,
        message: `Значение больше максимума${desc}`,
        expected: `<= ${rule.max}`,
        received: String(value),
      });
    }
  }

  // Проверка enum
  if (rule.enum && !rule.enum.includes(value)) {
    errors.push({
      path,
      message: `Недопустимое значение${desc}`,
      expected: `одно из [${rule.enum.join(", ")}]`,
      received: String(value),
    });
  }

  return { errors, warnings };
}

// ═══════════════════════════════════════════════════════════
// ВСТРОЕННЫЕ ВАЛИДАТОРЫ
// ═══════════════════════════════════════════════════════════

/** Паттерн Discord Snowflake ID (17-20 цифр) */
export const DISCORD_ID_PATTERN = /^\d{17,20}$/;

/** Паттерн URL */
export const URL_PATTERN = /^https?:\/\/.+/;

/** Паттерн времени HH:MM */
export const TIME_PATTERN = /^\d{2}:\d{2}$/;

/**
 * Валидирует что все значения в объекте — Discord ID
 */
export function validateDiscordIds(
  obj: Record<string, unknown>,
  path: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullPath = `${path}.${key}`;

    if (typeof value === "string") {
      if (value && !DISCORD_ID_PATTERN.test(value)) {
        errors.push({
          path: fullPath,
          message: "Невалидный Discord ID",
          expected: "17-20 цифр",
          received: value,
        });
      }
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === "string" && !DISCORD_ID_PATTERN.test(value[i])) {
          errors.push({
            path: `${fullPath}[${i}]`,
            message: "Невалидный Discord ID в массиве",
            expected: "17-20 цифр",
            received: value[i],
          });
        }
      }
    } else if (typeof value === "object" && value !== null) {
      errors.push(
        ...validateDiscordIds(value as Record<string, unknown>, fullPath)
      );
    }
  }

  return errors;
}

/**
 * Глубокая проверка структуры: все ключи из defaults присутствуют в data
 */
export function validateStructure(
  data: Record<string, unknown>,
  defaults: Record<string, unknown>,
  path: string = ""
): { missing: string[]; extra: string[] } {
  const missing: string[] = [];
  const extra: string[] = [];

  for (const key of Object.keys(defaults)) {
    const fullPath = path ? `${path}.${key}` : key;

    if (!(key in data)) {
      missing.push(fullPath);
      continue;
    }

    const defaultVal = defaults[key];
    const dataVal = data[key];

    if (
      defaultVal !== null &&
      typeof defaultVal === "object" &&
      !Array.isArray(defaultVal) &&
      typeof dataVal === "object" &&
      dataVal !== null &&
      !Array.isArray(dataVal)
    ) {
      const nested = validateStructure(
        dataVal as Record<string, unknown>,
        defaultVal as Record<string, unknown>,
        fullPath
      );
      missing.push(...nested.missing);
      extra.push(...nested.extra);
    }
  }

  for (const key of Object.keys(data)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (!(key in defaults)) {
      extra.push(fullPath);
    }
  }

  return { missing, extra };
}

// ═══════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════

/**
 * Проверяет, является ли объект вложенной схемой (а не FieldRule)
 */
function isNestedSchema(obj: unknown): obj is ValidationSchema {
  if (typeof obj !== "object" || obj === null) return false;
  // FieldRule всегда имеет поле "type" со значением из списка
  const candidate = obj as Record<string, unknown>;
  if (
    typeof candidate.type === "string" &&
    ["string", "number", "boolean", "array", "object"].includes(candidate.type)
  ) {
    return false; // Это FieldRule
  }
  return true; // Это вложенная схема
}

/**
 * Форматирует результат валидации в читаемую строку
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push("✅ Конфигурация валидна");
  } else {
    lines.push("❌ Ошибки конфигурации:");
    for (const err of result.errors) {
      lines.push(`  ✖ [${err.path}] ${err.message}`);
      if (err.expected) lines.push(`    Ожидалось: ${err.expected}`);
      if (err.received) lines.push(`    Получено:  ${err.received}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("⚠️ Предупреждения:");
    for (const warn of result.warnings) {
      lines.push(`  ⚡ [${warn.path}] ${warn.message}`);
    }
  }

  return lines.join("\n");
}