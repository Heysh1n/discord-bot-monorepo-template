// src/models/sync/utils.ts

import { createHash } from "crypto";

/**
 * Создать контрольную сумму для данных
 */
export function createChecksum(data: unknown): string {
  const str = JSON.stringify(data, Object.keys(data as object).sort());
  return createHash("md5").update(str).digest("hex");
}

/**
 * Сгенерировать уникальный ID документа
 */
export function generateDocumentId(path: string, key: string): string {
  return `${path}:${key}`;
}

/**
 * Разбить путь на части
 */
export function parsePath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Объединить части пути
 */
export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

/**
 * Проверить соответствие пути паттерну с wildcard
 */
export function matchPath(path: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return path === pattern || path.startsWith(pattern + "/");
  }

  const regex = pattern
    .replace(/\*/g, "[^/]+")
    .replace(/\//g, "\\/");
  
  return new RegExp(`^${regex}$`).test(path);
}

/**
 * Форматировать длительность в мс
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}мс`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}с`;
  return `${(ms / 60000).toFixed(1)}м`;
}