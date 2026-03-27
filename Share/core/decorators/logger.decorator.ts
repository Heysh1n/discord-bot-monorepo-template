// ═══════════════════════════════════════════════════════════
// ДЕКОРАТОР @logger
//
// Оборачивает методы класса логированием (start/end).
// ВСЕ функции логирования — реэкспорт из logSave.function.ts
// (единый источник правды для формата и цветов).
//
// ⚠️ Этот файл НЕ должен импортировать из конкретного бота!
//    Он shared — используется всеми ботами экосистемы.
// ═══════════════════════════════════════════════════════════

import {
  logInfo,
  logError,
  logWarn,
  logSuccess,
  logDebug,
  logLoaded,
  isCategoryEnabled,
  isLevelEnabled,
} from "@share/core/functions/logSave.function";

type AnyMethod = (...args: any[]) => any;

// ═══════════════════════════════════════════════════════════
// РЕЭКСПОРТ ЛОГГИРОВАНИЯ
//
// Любой модуль может импортировать log-функции отсюда
// ИЛИ напрямую из logSave — результат идентичен.
// ═══════════════════════════════════════════════════════════

// Алиас log → logInfo для обратной совместимости
export const log = logInfo;

export {
  logInfo,
  logError,
  logWarn,
  logSuccess,
  logDebug,
  logLoaded,
  isCategoryEnabled,
  isLevelEnabled,
};

// ═══════════════════════════════════════════════════════════
// ДЕКОРАТОР @logger
//
// Использование:
//   @logger("Старт...", "Готово!")
//   @logger("Старт...", "Готово!", { category: "STARTUP" })
//   @logger("Старт...", "Готово!", { force: true })
// ═══════════════════════════════════════════════════════════

interface LoggerOptions {
  /** Категория логирования (проверяется через isCategoryEnabled) */
  category?: string;
  /** Принудительно логировать, игнорируя WRAPPER_LOGS */
  force?: boolean;
}

export function logger(
  startMessage: string,
  endMessage: string,
  options?: LoggerOptions,
) {
  return function <T extends AnyMethod>(
    target: T,
    context: ClassMethodDecoratorContext<any, T>,
  ): T {
    const methodName = String(context.name);
    const category = options?.category;
    const force = options?.force ?? false;

    if (context.kind !== "method") {
      console.error(
        `[LOGGER DECORATOR ERROR] @logger только для методов класса. Проблема: ${methodName}`,
      );
      return target;
    }

    const wrapper = function (this: any, ...args: any[]) {
      const tag = methodName.toUpperCase();
      const shouldLog = force || isCategoryEnabled("WRAPPER_LOGS");

      // Если категория указана и отключена — пропускаем логи, выполняем метод
      if (category && !isCategoryEnabled(category)) {
        return target.apply(this, args);
      }

      if (shouldLog && startMessage) {
        logInfo(tag, startMessage);
      }

      const result = target.apply(this, args);

      // Async-методы
      if (result instanceof Promise) {
        return result
          .then((res) => {
            if (shouldLog && endMessage) logInfo(tag, endMessage);
            return res;
          })
          .catch((err) => {
            logError(tag, `ОШИБКА: ${err.message}`);
            throw err;
          });
      }

      // Sync-методы
      if (shouldLog && endMessage) logInfo(tag, endMessage);
      return result;
    } as T;

    return wrapper;
  };
}