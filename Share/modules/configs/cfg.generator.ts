import fs from "fs";
import path from "path";
import YAML from "yaml";

/**
 * @param filePath 
 * @param defaults
 * @param header
 * @returns
 */
export function generateYamlFile(
  filePath: string,
  defaults: Record<string, unknown>,
  header?: string
): boolean {
  if (fs.existsSync(filePath)) {
    return false;
  }

  // Создаём директорию если не существует
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Подготавливаем объект для YAML (убираем не-сериализуемые значения)
  const sanitized = sanitizeForYaml(defaults);

  // Генерируем YAML строку
  const yamlContent = YAML.stringify(sanitized, {
    indent: 2,
    lineWidth: 120,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
    nullStr: "",
    trueStr: "true",
    falseStr: "false",
  });

  // Собираем финальный контент
  const lines: string[] = [];

  if (header) {
    lines.push(formatYamlHeader(header));
    lines.push("");
  }

  lines.push(yamlContent);

  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  return true;
}

/**
 * Принудительно перезаписывает YAML файл
 */
export function forceRegenerateYamlFile(
  filePath: string,
  defaults: Record<string, unknown>,
  header?: string
): void {
  // Бэкап старого файла
  if (fs.existsSync(filePath)) {
    const backupPath = filePath + ".backup." + Date.now();
    fs.copyFileSync(filePath, backupPath);
    console.log(`[ConfigGen] 📦 Бэкап создан: ${path.basename(backupPath)}`);
  }

  // Удаляем и генерируем заново
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  generateYamlFile(filePath, defaults, header);
}

// САНИТИЗАЦИЯ ДЛЯ YAML

export function sanitizeForYaml(
  obj: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === "function" || typeof obj === "symbol") return undefined;

  if (typeof obj === "number") {
    if (Number.isNaN(obj) || !Number.isFinite(obj)) return null;
    return obj;
  }

  if (typeof obj === "string" || typeof obj === "boolean") return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof RegExp) return obj.source;
  if (typeof obj !== "object") return String(obj);


  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);

  let result: unknown;

  if (Array.isArray(obj)) {
    result = obj
      .map((item) => sanitizeForYaml(item, seen))
      .filter((item) => item !== undefined);
  } else {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const sanitized = sanitizeForYaml(value, seen);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    result = out;
  }

  // Убираем из seen — разрешаем повторные ссылки на этот объект
  seen.delete(obj);

  return result;
}

function formatYamlHeader(title: string): string {
  const maxLen = Math.max(title.length + 4, 60);
  const border = "#" + "═".repeat(maxLen) + "#";
  const padding = maxLen - title.length - 2;
  const left = Math.floor(padding / 2);
  const right = padding - left;

  return [
    border,
    `# ${" ".repeat(left)}${title}${" ".repeat(right)} #`,
    `# ${"─".repeat(maxLen - 2)} #`,
    `# ${" ".repeat(left)}AUTO-GENERATED FROM DEFAULTS${" ".repeat(Math.max(0, maxLen - 2 - left - 29))} #`,
    `# ${" ".repeat(left)}Edit values below as needed${" ".repeat(Math.max(0, maxLen - 2 - left - 28))} #`,
    border,
  ].join("\n");
}

export function addSectionComments(
  yamlContent: string,
  comments: Record<string, string>
): string {
  let result = yamlContent;

  for (const [key, comment] of Object.entries(comments)) {
    // Находим ключ на первом уровне (без отступа)
    const regex = new RegExp(`^(${key}:)`, "m");
    result = result.replace(regex, `\n# ${comment}\n$1`);
  }

  return result.replace(/^\n/, "");
}