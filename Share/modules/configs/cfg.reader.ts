// Share/modules/configs/cfg.reader.ts
// ═══════════════════════════════════════════════════════════
// ЧТЕНИЕ И ПАРСИНГ YAML КОНФИГУРАЦИИ
// ═══════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import YAML from "yaml";
import type { EnvSubstitution } from "./cfg.types.js";

// ═══════════════════════════════════════════════════════════
// ЧТЕНИЕ ФАЙЛА
// ═══════════════════════════════════════════════════════════

/**
 * Читает YAML файл и возвращает распарсенный объект
 * @param filePath - Абсолютный путь к YAML файлу
 * @returns Распарсенный объект или null если файл не существует
 */
export function readYamlFile<T = Record<string, unknown>>(
  filePath: string
): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");

  if (!raw.trim()) {
    return null;
  }

  // Подставляем env-переменные перед парсингом
  const substituted = substituteEnvVariables(raw);

  const parsed = YAML.parse(substituted, {
    merge: true,
    prettyErrors: true,
  });

  return parsed as T;
}

/**
 * Безопасное чтение — при ошибке возвращает null и логирует
 */
export function safeReadYamlFile<T = Record<string, unknown>>(
  filePath: string,
  verbose: boolean = true
): { data: T | null; error: string | null } {
  try {
    const data = readYamlFile<T>(filePath);
    return { data, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Неизвестная ошибка чтения YAML";

    if (verbose) {
      console.error(`[ConfigReader] ❌ Ошибка чтения ${path.basename(filePath)}: ${message}`);
    }

    return { data: null, error: message };
  }
}

// ═══════════════════════════════════════════════════════════
// ENV-ПОДСТАНОВКА
// ═══════════════════════════════════════════════════════════

/**
 * Regex для поиска ${VAR_NAME} или ${VAR_NAME:default_value}
 */
const ENV_REGEX = /\$\{([^}:]+)(?::([^}]*))?\}/g;

/**
 * Подставляет значения env-переменных в строку YAML
 *
 * Синтаксис:
 *   ${VAR_NAME}           — обязательная переменная
 *   ${VAR_NAME:default}   — с дефолтным значением
 *
 * Примеры в YAML:
 *   name: "${INSCRIPTION:SERVER NAME}"
 *   avatar: "${IMAGE_URL:https://example.com/img.png}"
 */
export function substituteEnvVariables(content: string): string {
  return content.replace(ENV_REGEX, (fullMatch, varName: string, defaultValue?: string) => {
    const envValue = process.env[varName.trim()];

    if (envValue !== undefined) {
      return envValue;
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }

    // Переменная не найдена и нет дефолта — оставляем как есть
    console.warn(
      `[ConfigReader] ⚠️ ENV переменная "${varName}" не найдена и нет дефолта`
    );
    return fullMatch;
  });
}

/**
 * Извлекает все env-подстановки из строки (для отладки)
 */
export function extractEnvSubstitutions(content: string): EnvSubstitution[] {
  const results: EnvSubstitution[] = [];
  let match: RegExpExecArray | null;

  const regex = new RegExp(ENV_REGEX.source, "g");
  while ((match = regex.exec(content)) !== null) {
    results.push({
      fullMatch: match[0],
      variable: match[1].trim(),
      defaultValue: match[2],
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// ГЛУБОКОЕ СЛИЯНИЕ
// ═══════════════════════════════════════════════════════════

/**
 * Глубоко мержит YAML-данные с дефолтами.
 * YAML имеет приоритет. Отсутствующие в YAML ключи берутся из дефолтов.
 */
export function deepMergeWithDefaults<T extends Record<string, unknown>>(
  yamlData: Record<string, unknown>,
  defaults: T
): T {
  const result = { ...defaults };

  for (const key of Object.keys(defaults)) {
    const yamlVal = yamlData[key];
    const defaultVal = defaults[key];

    if (yamlVal === undefined) {
      // В YAML нет этого ключа — берём дефолт
      continue;
    }

    if (
      defaultVal !== null &&
      typeof defaultVal === "object" &&
      !Array.isArray(defaultVal) &&
      yamlVal !== null &&
      typeof yamlVal === "object" &&
      !Array.isArray(yamlVal)
    ) {
      // Рекурсивное слияние объектов
      (result as Record<string, unknown>)[key] = deepMergeWithDefaults(
        yamlVal as Record<string, unknown>,
        defaultVal as Record<string, unknown>
      );
    } else {
      // Примитив или массив — YAML перезаписывает дефолт
      (result as Record<string, unknown>)[key] = yamlVal;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════

/**
 * Проверяет существование YAML файла
 */
export function yamlFileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Возвращает время последней модификации файла
 */
export function getFileModTime(filePath: string): Date | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime;
  } catch {
    return null;
  }
}