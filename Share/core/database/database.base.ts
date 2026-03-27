import fs from "fs";
import path from "path";
import { getBotPaths } from "../../constants.js";
import {
  logInfo,
  logError,
  logWarn,
  logDebug,
} from "../functions/logSave.function.js";

// ТИПЫ
export interface DBFileConfig {
  /** Имя JSON-файла (e.g. "staff.json") */
  fileName: string;
  /** Поддиректория внутри BotPaths.localDB (e.g. "staff") */
  directory: string;
  /** Задержка перед записью на диск (мс) */
  saveDebounceMs: number;
  /** Создавать бэкап при битом JSON */
  backupOnCorrupted: boolean;
  /** Валидировать все записи при загрузке */
  validateOnLoad: boolean;
  /** Восстанавливать невалидные записи */
  repairOnError: boolean;
}

/** Флаги логирования */
export interface DBLogConfig {
  logLoads: boolean;
  logSaves: boolean;
  logRepairs: boolean;
}

/** Адаптер — для внешних потребителей (sync, миграции) */
export interface DBAdapter<T> {
  get(id: string): T | null;
  set(id: string, data: T): void;
  exists(id: string): boolean;
  delete(id: string): boolean;
  getAll(): Record<string, T>;
  update(id: string, partial: Partial<T>): T | null;
}

// ДЕФОЛТЫ
const DEFAULTS: { config: DBFileConfig; logging: DBLogConfig } = {
  config: {
    fileName: "data.json",
    directory: "",
    saveDebounceMs: 2000,
    backupOnCorrupted: true,
    validateOnLoad: true,
    repairOnError: true,
  },
  logging: {
    logLoads: true,
    logSaves: false,
    logRepairs: true,
  },
};

// АБСТРАКТНЫЙ БАЗОВЫЙ КЛАСС
export abstract class LocalDBBase<T extends object> implements DBAdapter<T> {
  // ─── Состояние
  protected cache: Record<string, T> | null = null;
  protected isDirty = false;
  protected saveTimeout: NodeJS.Timeout | null = null;

  // ─── Resolved 
  protected readonly filePath: string;
  protected readonly tag: string;
  protected readonly cfg: DBFileConfig;
  protected readonly log: DBLogConfig;

  constructor(
    tag: string,
    config?: Partial<DBFileConfig>,
    logging?: Partial<DBLogConfig>,
  ) {
    this.tag = tag;
    this.cfg = { ...DEFAULTS.config, ...config };
    this.log = { ...DEFAULTS.logging, ...logging };
    const dbRoot = getBotPaths().localDB;
    const dir = this.cfg.directory
      ? path.join(dbRoot, this.cfg.directory)
      : dbRoot;
    this.filePath = path.join(dir, this.cfg.fileName);
  }

  // АБСТРАКТНЫЕ МЕТОДЫ — реализуй в своей модели
  /** Type-guard: является ли data валидным T */
  protected abstract validateItem(data: unknown): data is T;

  /** Восстановить битые данные до валидного T */
  protected abstract repairItem(data: Partial<T>, id: string): T;

  /** Создать новый элемент с дефолтными значениями */
  protected abstract createDefault(id: string, ...args: unknown[]): T;


  // ХУКИ — переопредели в подклассе при необходимости


  /** Миграция старого формата данных при загрузке */
  protected migrate(data: unknown): unknown {
    return data;
  }

  /** Валидация ID записи (по умолчанию: Discord Snowflake) */
  protected validateId(id: string): boolean {
    return /^\d{17,19}$/.test(id);
  }

  /** Хук после успешной загрузки (для подписок, таймеров и т.д.) */
  protected onLoaded(_data: Record<string, T>): void {}

  /** Хук после сохранения */
  protected onSaved(): void {}


  // ЗАГРУЗКА / СОХРАНЕНИЕ


  protected load(): Record<string, T> {
    if (this.cache) return this.cache;

    try {
      this.ensureDir();

      // Файл не существует → создаём пустой
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, "{}", "utf-8");
        if (this.log.logLoads) {
          logInfo(this.tag, `📁 Создан: ${this.cfg.fileName}`);
        }
        this.cache = {};
        return this.cache;
      }

      // Читаем и парсим
      const raw = fs.readFileSync(this.filePath, "utf-8");
      let parsed: unknown;

      try {
        parsed = JSON.parse(raw || "{}");
      } catch (parseErr) {
        logError(this.tag, `❌ JSON parse error: ${parseErr}`);
        if (this.cfg.backupOnCorrupted) this.backup("corrupted");
        parsed = {};
      }

      // Миграция (хук)
      parsed = this.migrate(parsed);

      // Валидация
      const db = this.cfg.validateOnLoad
        ? this.validateAndRepairAll(parsed as Record<string, T>)
        : (parsed as Record<string, T>);

      this.cache = db;

      if (this.log.logLoads) {
        logInfo(this.tag, `📂 Загружено: ${Object.keys(db).length} записей`);
      }

      this.onLoaded(db);
      return db;
    } catch (error) {
      logError(this.tag, `❌ Критическая ошибка загрузки: ${error}`);
      this.cache = {};
      return {};
    }
  }

  protected save(data: Record<string, T>): void {
    this.cache = data;
    this.isDirty = true;

    if (this.saveTimeout) clearTimeout(this.saveTimeout);

    this.saveTimeout = setTimeout(
      () => this.flush(),
      this.cfg.saveDebounceMs,
    );
  }

  /** Немедленная запись на диск */
  protected flush(): void {
    if (!this.cache || !this.isDirty) return;

    try {
      this.ensureDir();

      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.cache, null, 2),
        "utf-8",
      );
      this.isDirty = false;

      if (this.log.logSaves) {
        logDebug(this.tag, "💾 Saved");
      }

      this.onSaved();
    } catch (error) {
      logError(this.tag, `❌ Ошибка записи: ${error}`);
    }
  }

  // CRUD
  /** Получить запись по ID */
  get(id: string): T | null {
    return this.load()[id] ?? null;
  }

  /** Проверить существование */
  exists(id: string): boolean {
    return id in this.load();
  }

  /** Установить/перезаписать запись */
  set(id: string, data: T): void {
    const db = this.load();
    db[id] = data;
    this.save(db);
  }

  /** Частичное обновление (deep merge) */
  update(id: string, partial: Partial<T>): T | null {
    const db = this.load();
    const item = db[id];
    if (!item) return null;

    db[id] = this.deepMerge(item, partial);
    this.save(db);
    return db[id];
  }

  /** Удалить запись */
  delete(id: string): boolean {
    const db = this.load();
    if (!(id in db)) return false;

    delete db[id];
    this.save(db);
    return true;
  }

  /** Создать запись (пропустить если существует) */
  create(id: string, ...args: unknown[]): T {
    const existing = this.get(id);
    if (existing) return existing;

    const item = this.createDefault(id, ...args);
    this.set(id, item);
    logInfo(this.tag, `➕ Создан: ${id}`);
    return item;
  }

  /** Получить или создать (getOrCreate pattern) */
  ensure(id: string, ...args: unknown[]): T {
    return this.get(id) ?? this.create(id, ...args);
  }


  // МАССОВЫЕ ОПЕРАЦИИ
  /** Копия всех данных */
  getAll(): Record<string, T> {
    return { ...this.load() };
  }

  /** Все ID */
  getAllIds(): string[] {
    return Object.keys(this.load());
  }

  /** Количество записей */
  getCount(): number {
    return Object.keys(this.load()).length;
  }

  /** Очистить базу */
  clear(): void {
    this.cache = {};
    this.save({});
    logWarn(this.tag, "🗑️ База очищена");
  }

  /** Перезаписать всю базу */
  setAll(data: Record<string, T>): void {
    this.cache = data;
    this.isDirty = true;
    this.flush();
  }

  // ПОИСК И СОРТИРОВКА
  /** Найти записи по предикату */
  find(predicate: (id: string, data: T) => boolean): Array<[string, T]> {
    return Object.entries(this.load()).filter(([id, data]) => predicate(id, data));
  }

  /** Найти первую запись по предикату */
  findOne(predicate: (id: string, data: T) => boolean): [string, T] | null {
    for (const [id, data] of Object.entries(this.load())) {
      if (predicate(id, data)) return [id, data];
    }
    return null;
  }

  /** Отсортированные записи (с опциональным лимитом) */
  sorted(
    compareFn: (a: [string, T], b: [string, T]) => number,
    limit?: number,
  ): Array<[string, T]> {
    const entries = Object.entries(this.load()).sort(compareFn);
    return limit ? entries.slice(0, limit) : entries;
  }

  /** Топ N по числовому полю */
  topBy(
    field: (data: T) => number,
    limit: number = 10,
  ): Array<{ id: string; data: T; value: number }> {
    return Object.entries(this.load())
      .map(([id, data]) => ({ id, data, value: field(data) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }


  // УПРАВЛЕНИЕ КЭШЕМ


  /** Принудительное сохранение (flush debounce) */
  saveAll(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.flush();
  }

  /** Сохранить + сбросить кэш (следующий доступ перечитает файл) */
  invalidate(): void {
    this.saveAll();
    this.cache = null;
  }

  /** Перезагрузить из файла (отбросить несохранённые изменения) */
  reload(): Record<string, T> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.cache = null;
    this.isDirty = false;
    return this.load();
  }


  // БЭКАПЫ


  protected backup(reason: string): void {
    try {
      if (!fs.existsSync(this.filePath)) return;

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = this.filePath.replace(
        ".json",
        `_${reason}_${ts}.json`,
      );
      fs.copyFileSync(this.filePath, backupPath);
      logInfo(this.tag, `📦 Бэкап: ${path.basename(backupPath)}`);
    } catch (error) {
      logError(this.tag, `❌ Ошибка бэкапа: ${error}`);
    }
  }

  /** Публичный метод для ручного бэкапа */
  createBackup(reason: string = "manual"): void {
    this.saveAll();
    this.backup(reason);
  }

  // МЕТАИНФО
  getTag(): string {
    return this.tag;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getStatus(): {
    tag: string;
    filePath: string;
    records: number;
    cached: boolean;
    dirty: boolean;
  } {
    return {
      tag: this.tag,
      filePath: this.filePath,
      records: this.cache ? Object.keys(this.cache).length : -1,
      cached: this.cache !== null,
      dirty: this.isDirty,
    };
  }

  // ВНУТРЕННИЕ МЕТОДЫ
  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private validateAndRepairAll(
    data: Record<string, T>,
  ): Record<string, T> {
    if (!data || typeof data !== "object") {
      logWarn(this.tag, "⚠️ Невалидные данные, создаём пустую базу");
      return {};
    }

    const result: Record<string, T> = {};
    let repaired = 0;
    let skipped = 0;

    for (const [id, item] of Object.entries(data)) {
      // Валидация ID
      if (!this.validateId(id)) {
        logWarn(this.tag, `⚠️ Невалидный ID: ${id}`);
        skipped++;
        continue;
      }

      // Валидация данных
      if (this.validateItem(item)) {
        result[id] = item;
      } else if (this.cfg.repairOnError) {
        result[id] = this.repairItem(item as Partial<T>, id);
        repaired++;
      } else {
        skipped++;
      }
    }

    if (repaired > 0 && this.log.logRepairs) {
      logWarn(this.tag, `🔧 Восстановлено: ${repaired} записей`);
    }
    if (skipped > 0) {
      logWarn(this.tag, `⏭️ Пропущено: ${skipped} невалидных записей`);
    }

    return result;
  }

  protected deepMerge(target: T, source: Partial<T>): T {
    const result = { ...target } as Record<string, unknown>;

    for (const [key, sourceVal] of Object.entries(
      source as Record<string, unknown>,
    )) {
      if (sourceVal === undefined) continue;

      const targetVal = result[key];

      if (
        sourceVal !== null &&
        typeof sourceVal === "object" &&
        !Array.isArray(sourceVal) &&
        targetVal !== null &&
        typeof targetVal === "object" &&
        !Array.isArray(targetVal)
      ) {
        result[key] = this.deepMerge(
          targetVal as T,
          sourceVal as Partial<T>,
        );
      } else {
        result[key] = sourceVal;
      }
    }

    return result as T;
  }
}