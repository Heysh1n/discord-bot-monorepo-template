import { LocalDBBase, DBFileConfig, DBLogConfig } from "../database.base.js";
import {
  logInfo,
  logError,
  logWarn,
  logDebug,
} from "../../functions/logSave.function.js";

// ТИПЫ
/** Определение вторичного индекса */
export interface IndexDefinition<T> {
  /** Уникальное имя индекса */
  name: string;
  /** Функция извлечения ключа из записи (может вернуть массив для multi-key) */
  keyFn: (data: T) => string | string[] | null | undefined;
  /** Если true — один ключ → максимум одна запись */
  unique?: boolean;
}

/** Событие мутации данных */
export interface DBChangeEvent<T> {
  type: "set" | "update" | "delete" | "clear" | "batch";
  id: string;
  ids?: string[];
  oldValue?: T;
  newValue?: T;
  timestamp: number;
}

/** Статистика доступа */
export interface DBAccessStats {
  reads: number;
  writes: number;
  cacheHits: number;
  cacheMisses: number;
  indexLookups: number;
  batchOps: number;
  ttlExpirations: number;
  createdAt: number;
}

/** Колбэк на изменения */
export type DBChangeListener<T> = (event: DBChangeEvent<T>) => void;

/** Элемент batch-update */
export interface BatchUpdateEntry<T> {
  id: string;
  data: Partial<T>;
}

/** TTL-запись (внутренняя) */
interface TTLEntry {
  expiresAt: number;
  timerId: NodeJS.Timeout;
}

/** Расширенный конфиг для EnhancedLocalDB */
export interface EnhancedDBConfig extends Partial<DBFileConfig> {
  /** Максимальный размер лога изменений (ring buffer) */
  maxChangeLogSize?: number;
  /** Интервал фоновой очистки TTL (мс) */
  ttlCleanupIntervalMs?: number;
  /** Авто-регистрация в LocalDBRegistry */
  autoRegister?: boolean;
}

//  REGISTRY — Singleton, управляет всеми экземплярами LocalDB
//
//  Зачем:
//    • flushAll() при shutdown — ни одна запись не потеряется
//    • backupAll() по расписанию
//    • statusAll() для диагностики
//    • Единая точка управления жизненным циклом всех баз
//

class LocalDBRegistryImpl {
  private databases = new Map<string, LocalDBBase<any>>();
  private shutdownBound = false;
  private autoBackupTimer: NodeJS.Timeout | null = null;

  // ─── Регистрация

  /** Зарегистрировать БД в реестре */
  register<T extends object>(db: LocalDBBase<T>): void {
    const tag = db.getTag();
    if (this.databases.has(tag)) {
      logWarn("DB_REG", `⚠️ "${tag}" already registered, replacing`);
    }
    this.databases.set(tag, db);
    logDebug("DB_REG", `📦 Registered: ${tag} (total: ${this.databases.size})`);
  }

  /** Сохранить и убрать БД из реестра */
  unregister(tag: string): void {
    const db = this.databases.get(tag);
    if (db) {
      db.saveAll();
      this.databases.delete(tag);
      logDebug("DB_REG", `🗑️ Unregistered: ${tag}`);
    }
  }

  /** Получить БД по тегу */
  get<T extends object>(tag: string): LocalDBBase<T> | undefined {
    return this.databases.get(tag) as LocalDBBase<T> | undefined;
  }

  /** Все зарегистрированные БД */
  getAll(): LocalDBBase<any>[] {
    return [...this.databases.values()];
  }

  /** Все теги */
  getTags(): string[] {
    return [...this.databases.keys()];
  }

  has(tag: string): boolean {
    return this.databases.has(tag);
  }

  get size(): number {
    return this.databases.size;
  }

  // ─── Массовые операции 
  /** Сбросить все несохранённые данные на диск */
  flushAll(): void {
    let ok = 0;
    for (const db of this.databases.values()) {
      try {
        db.saveAll();
        ok++;
      } catch (err) {
        logError("DB_REG", `Flush failed [${db.getTag()}]: ${err}`);
      }
    }
    logInfo("DB_REG", `💾 Flushed ${ok}/${this.databases.size} databases`);
  }

  /** Перечитать все БД с диска */
  reloadAll(): void {
    for (const db of this.databases.values()) {
      try {
        db.reload();
      } catch (err) {
        logError("DB_REG", `Reload failed [${db.getTag()}]: ${err}`);
      }
    }
    logInfo("DB_REG", `🔄 Reloaded ${this.databases.size} databases`);
  }

  /** Бэкап всех БД */
  backupAll(reason: string = "scheduled"): void {
    for (const db of this.databases.values()) {
      try {
        db.createBackup(reason);
      } catch (err) {
        logError("DB_REG", `Backup failed [${db.getTag()}]: ${err}`);
      }
    }
    logInfo("DB_REG", `📦 Backup complete (${this.databases.size} dbs, reason: ${reason})`);
  }

  /** Сбросить кэш всех БД (следующий доступ перечитает файлы) */
  invalidateAll(): void {
    for (const db of this.databases.values()) {
      db.invalidate();
    }
  }

  /** Статус всех БД */
  statusAll() {
    return [...this.databases.values()].map((db) => db.getStatus());
  }

  // ─── Shutdown hooks 
  setupShutdownHooks(): void {
    if (this.shutdownBound) return;
    this.shutdownBound = true;

    const onShutdown = () => {
      logInfo("DB_REG", "🛑 Shutdown — flushing all databases...");
      this.flushAll();
    };

    process.once("SIGINT", onShutdown);
    process.once("SIGTERM", onShutdown);
    process.once("beforeExit", onShutdown);
    logDebug("DB_REG", "🔗 Shutdown hooks installed");
  }

  // ─── Auto-backup

  /** Запустить периодический бэкап (по умолчанию каждые 30 мин) */
  startAutoBackup(intervalMs: number = 30 * 60_000, reason = "auto"): void {
    this.stopAutoBackup();
    this.autoBackupTimer = setInterval(() => this.backupAll(reason), intervalMs);
    if (this.autoBackupTimer.unref) this.autoBackupTimer.unref();
    logInfo("DB_REG", `⏰ Auto-backup every ${(intervalMs / 60_000).toFixed(1)}min`);
  }

  stopAutoBackup(): void {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }
  }

  // ─── Cleanup

  destroy(): void {
    this.stopAutoBackup();
    this.flushAll();
    this.databases.clear();
  }
}

/** Глобальный реестр всех локальных баз данных */
export const LocalDBRegistry = new LocalDBRegistryImpl();

//  ENHANCED LOCAL DB
//
//  Расширяет LocalDBBase:
//    • Вторичные индексы (in-memory) — O(1) поиск по любому полю
//    • Change events — подписки на мутации
//    • TTL per record — автоудаление по таймеру
//    • Batch-операции — setMany / updateMany / deleteMany
//    • Агрегация — groupBy / map / reduce / sumBy
//    • Статистика — reads, writes, hits, misses
//    • Авто-регистрация в LocalDBRegistry
//
//  Использование:
//
//    class StaffDB extends EnhancedLocalDB<StaffData> {
//      constructor() {
//        super("STAFF_DB", { fileName: "staff.json", directory: "staff" });
//
//        // Вторичный индекс по guildId (один юзер → один гильд)
//        this.defineIndex({ name: "guild", keyFn: (d) => d.guildId });
//
//        // Multi-key индекс по ролям
//        this.defineIndex({ name: "roles", keyFn: (d) => d.roleIds });
//      }
//
//      protected validateItem(data: unknown): data is StaffData { ... }
//      protected repairItem(data: Partial<StaffData>, id: string): StaffData { ... }
//      protected createDefault(id: string): StaffData { ... }
//    }
//
//    const db = new StaffDB();
//
//    // Поиск по индексу — O(1) вместо O(n)
//    const guildStaff = db.findByIndex("guild", "123456789");
//
//    // Подписка на изменения
//    db.onChange((e) => console.log(`${e.type}: ${e.id}`));
//
//    // TTL — запись удалится через 1 час
//    db.setWithTTL("temp-user", data, 60 * 60 * 1000);
//
//    // Batch
//    db.setMany([{ id: "1", data: d1 }, { id: "2", data: d2 }]);


export abstract class EnhancedLocalDB<T extends object> extends LocalDBBase<T> {
  // ─── Индексы 
  private _indexes = new Map<string, Map<string, Set<string>>>();
  private _indexDefs: IndexDefinition<T>[] = [];
  private _indexesBuilt = false;

  // ─── Change 
  private _changeListeners = new Set<DBChangeListener<T>>();
  private _changeLog: DBChangeEvent<T>[] = [];
  private _maxChangeLogSize: number;

  // ─── TTL
  private _ttlMap = new Map<string, TTLEntry>();
  private _ttlCleanupTimer: NodeJS.Timeout | null = null;
  private _ttlCleanupIntervalMs: number;

  // ─── Статистика 
  private _stats: DBAccessStats = {
    reads: 0,
    writes: 0,
    cacheHits: 0,
    cacheMisses: 0,
    indexLookups: 0,
    batchOps: 0,
    ttlExpirations: 0,
    createdAt: Date.now(),
  };

  constructor(
    tag: string,
    config?: EnhancedDBConfig,
    logging?: Partial<DBLogConfig>,
  ) {
    super(tag, config, logging);
    this._maxChangeLogSize = config?.maxChangeLogSize ?? 200;
    this._ttlCleanupIntervalMs = config?.ttlCleanupIntervalMs ?? 60_000;

    // Авто-регистрация (можно отключить через autoRegister: false)
    if (config?.autoRegister !== false) {
      LocalDBRegistry.register(this);
    }
  }

  
  // ВТОРИЧНЫЕ ИНДЕКСЫ
    /*
   *
   * @example
   * this.defineIndex({
   *   name: "guild",
   *   keyFn: (data) => data.guildId,
   * });
   *
   * // multi-key: одна запись попадает в несколько ключей
   * this.defineIndex({
   *   name: "tags",
   *   keyFn: (data) => data.tags, // string[]
   * });
   */
  protected defineIndex(def: IndexDefinition<T>): void {
    this._indexDefs.push(def);
    this._indexes.set(def.name, new Map());

    // Если данные уже загружены — сразу построить
    if (this.cache) {
      this._rebuildSingleIndex(def);
    }
  }

  /** Найти ВСЕ записи по значению индекса */
  findByIndex(indexName: string, key: string): T[] {
    this._ensureIndexes();
    this._stats.indexLookups++;

    const idx = this._indexes.get(indexName);
    if (!idx) {
      logWarn(this.tag, `Index "${indexName}" not defined`);
      return [];
    }

    const ids = idx.get(key);
    if (!ids || ids.size === 0) return [];

    const data = this.load();
    const results: T[] = [];
    for (const id of ids) {
      if (data[id]) results.push(data[id]);
    }
    return results;
  }

  /** Найти ПЕРВУЮ запись по значению индекса */
  findOneByIndex(
    indexName: string,
    key: string,
  ): { id: string; data: T } | null {
    this._ensureIndexes();
    this._stats.indexLookups++;

    const idx = this._indexes.get(indexName);
    if (!idx) return null;

    const ids = idx.get(key);
    if (!ids || ids.size === 0) return null;

    const firstId = ids.values().next().value;
    if (!firstId) return null;

    const data = this.get(firstId);
    return data ? { id: firstId, data } : null;
  }

  /** Проверить наличие значения в индексе */
  existsInIndex(indexName: string, key: string): boolean {
    this._ensureIndexes();
    const idx = this._indexes.get(indexName);
    if (!idx) return false;
    const set = idx.get(key);
    return !!set && set.size > 0;
  }

  /** Получить все уникальные ключи индекса */
  getIndexKeys(indexName: string): string[] {
    this._ensureIndexes();
    const idx = this._indexes.get(indexName);
    return idx ? [...idx.keys()] : [];
  }

  /** Количество уникальных ключей в индексе */
  getIndexSize(indexName: string): number {
    this._ensureIndexes();
    return this._indexes.get(indexName)?.size ?? 0;
  }

  // ─── Внутренние методы индексации 

  private _ensureIndexes(): void {
    if (this._indexesBuilt || this._indexDefs.length === 0) return;
    // load() → onLoaded() → _rebuildAllIndexes() → _indexesBuilt = true
    this.load();
  }

  private _rebuildAllIndexes(): void {
    for (const def of this._indexDefs) {
      this._rebuildSingleIndex(def);
    }
  }

  private _rebuildSingleIndex(def: IndexDefinition<T>): void {
    const idx = new Map<string, Set<string>>();
    // Используем this.cache напрямую (не this.load()) — избегаем рекурсии.
    // Вызывается из onLoaded(), к этому моменту cache уже заполнен.
    const data = this.cache ?? {};

    for (const [id, item] of Object.entries(data)) {
      for (const key of this._extractKeys(def, item)) {
        let set = idx.get(key);
        if (!set) {
          set = new Set();
          idx.set(key, set);
        }
        set.add(id);
      }
    }
    this._indexes.set(def.name, idx);
  }

  private _extractKeys(def: IndexDefinition<T>, data: T): string[] {
    const raw = def.keyFn(data);
    if (raw == null) return [];
    return Array.isArray(raw) ? raw.filter(Boolean) : [raw];
  }

  private _addToIndexes(id: string, data: T): void {
    for (const def of this._indexDefs) {
      const idx = this._indexes.get(def.name);
      if (!idx) continue;
      for (const key of this._extractKeys(def, data)) {
        let set = idx.get(key);
        if (!set) {
          set = new Set();
          idx.set(key, set);
        }
        set.add(id);
      }
    }
  }

  private _removeFromIndexes(id: string, data: T): void {
    for (const def of this._indexDefs) {
      const idx = this._indexes.get(def.name);
      if (!idx) continue;
      for (const key of this._extractKeys(def, data)) {
        const set = idx.get(key);
        if (set) {
          set.delete(id);
          if (set.size === 0) idx.delete(key);
        }
      }
    }
  }

  // CHANGE EVENTS
  /**
   * Подписка на изменения. Возвращает функцию отписки.
   *
   * @example
   * const unsub = db.onChange((event) => {
   *   if (event.type === "set") {
   *     console.log(`Record ${event.id} updated`);
   *   }
   * });
   * // Позже:
   * unsub();
   */
  onChange(listener: DBChangeListener<T>): () => void {
    this._changeListeners.add(listener);
    return () => this._changeListeners.delete(listener);
  }

  /** Явная отписка */
  offChange(listener: DBChangeListener<T>): void {
    this._changeListeners.delete(listener);
  }

  /** Лог последних изменений (ring buffer) */
  getChangeLog(): ReadonlyArray<DBChangeEvent<T>> {
    return this._changeLog;
  }

  clearChangeLog(): void {
    this._changeLog.length = 0;
  }

  private _emitChange(event: DBChangeEvent<T>): void {
    // Ring buffer
    this._changeLog.push(event);
    if (this._changeLog.length > this._maxChangeLogSize) {
      this._changeLog.splice(
        0,
        this._changeLog.length - this._maxChangeLogSize,
      );
    }
    // Оповещаем слушателей
    for (const listener of this._changeListeners) {
      try {
        listener(event);
      } catch (err) {
        logError(this.tag, `Change listener error: ${err}`);
      }
    }
  }

  
  // TTL PER RECORD

  /**
   * Записать данные с автоудалением через ttlMs миллисекунд.
   *
   * @example
   * db.setWithTTL("temp-session-123", sessionData, 30 * 60_000); // 30 мин
   */
  setWithTTL(id: string, data: T, ttlMs: number): void {
    this.set(id, data);
    this._setTTLTimer(id, ttlMs);
  }

  /** Установить/обновить TTL на существующую запись */
  setTTL(id: string, ttlMs: number): boolean {
    if (!this.exists(id)) return false;
    this._setTTLTimer(id, ttlMs);
    return true;
  }

  /** Убрать TTL (запись становится постоянной) */
  removeTTL(id: string): boolean {
    return this._clearTTLTimer(id);
  }

  /** Оставшееся время TTL в мс (null = нет TTL) */
  getRemainingTTL(id: string): number | null {
    const entry = this._ttlMap.get(id);
    if (!entry) return null;
    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /** Есть ли TTL на записи */
  hasTTL(id: string): boolean {
    return this._ttlMap.has(id);
  }

  /** Запустить фоновую очистку просроченных TTL */
  startTTLCleanup(): void {
    this.stopTTLCleanup();
    this._ttlCleanupTimer = setInterval(
      () => this._cleanupExpiredTTLs(),
      this._ttlCleanupIntervalMs,
    );
    if (this._ttlCleanupTimer.unref) this._ttlCleanupTimer.unref();
  }

  stopTTLCleanup(): void {
    if (this._ttlCleanupTimer) {
      clearInterval(this._ttlCleanupTimer);
      this._ttlCleanupTimer = null;
    }
  }

  // ─── TTL internals 
  private _setTTLTimer(id: string, ttlMs: number): void {
    this._clearTTLTimer(id);
    const expiresAt = Date.now() + ttlMs;
    const timerId = setTimeout(() => this._onTTLExpired(id), ttlMs);
    if (timerId.unref) timerId.unref(); // Не держим процесс
    this._ttlMap.set(id, { expiresAt, timerId });
  }

  private _clearTTLTimer(id: string): boolean {
    const entry = this._ttlMap.get(id);
    if (!entry) return false;
    clearTimeout(entry.timerId);
    this._ttlMap.delete(id);
    return true;
  }

  private _onTTLExpired(id: string): void {
    this._ttlMap.delete(id);
    if (this.exists(id)) {
      logDebug(this.tag, `⏰ TTL expired: ${id}`);
      this.delete(id);
      this._stats.ttlExpirations++;
    }
  }

  private _cleanupExpiredTTLs(): void {
    const now = Date.now();
    for (const [id, entry] of this._ttlMap) {
      if (entry.expiresAt <= now) {
        this._onTTLExpired(id);
      }
    }
  }

  // OVERRIDES — поддержка индексов, событий, статистики
  override get(id: string): T | null {
    this._stats.reads++;
    const result = super.get(id);
    if (result !== null) this._stats.cacheHits++;
    else this._stats.cacheMisses++;
    return result;
  }

  override set(id: string, data: T): void {
    const db = this.load();
    const oldValue = db[id] as T | undefined;
    if (oldValue) this._removeFromIndexes(id, oldValue);

    super.set(id, data);

    this._addToIndexes(id, data);
    this._stats.writes++;

    this._emitChange({
      type: "set",
      id,
      oldValue,
      newValue: data,
      timestamp: Date.now(),
    });
  }

  override update(id: string, partial: Partial<T>): T | null {
    const db = this.load();
    const oldValue = db[id] as T | undefined;
    if (oldValue) this._removeFromIndexes(id, oldValue);

    const result = super.update(id, partial);

    if (result) {
      this._addToIndexes(id, result);
      this._stats.writes++;

      this._emitChange({
        type: "update",
        id,
        oldValue,
        newValue: result,
        timestamp: Date.now(),
      });
    }
    return result;
  }

  override delete(id: string): boolean {
    const db = this.load();
    const oldValue = db[id] as T | undefined;
    if (oldValue) this._removeFromIndexes(id, oldValue);
    this._clearTTLTimer(id);

    const deleted = super.delete(id);

    if (deleted) {
      this._stats.writes++;
      this._emitChange({
        type: "delete",
        id,
        oldValue,
        timestamp: Date.now(),
      });
    }
    return deleted;
  }

  override clear(): void {
    // Чистим все TTL таймеры
    for (const [id] of this._ttlMap) {
      this._clearTTLTimer(id);
    }

    super.clear();

    // Индексы пустые после clear
    for (const def of this._indexDefs) {
      this._indexes.set(def.name, new Map());
    }
    this._stats.writes++;

    this._emitChange({
      type: "clear",
      id: "*",
      timestamp: Date.now(),
    });
  }

  override invalidate(): void {
    this._indexesBuilt = false;
    super.invalidate();
  }

  override reload(): Record<string, T> {
    this._indexesBuilt = false;
    return super.reload();
  }

  /** Хук после загрузки — перестраиваем индексы */
  protected override onLoaded(_data: Record<string, T>): void {
    if (this._indexDefs.length > 0) {
      this._rebuildAllIndexes();
    }
    this._indexesBuilt = true;
  }

  // BATCH-ОПЕРАЦИИ
  /**
   * Массовая запись (один save на диск вместо N).
   * @returns Количество записанных
   */
  setMany(entries: Array<{ id: string; data: T }>): number {
    if (entries.length === 0) return 0;

    const db = this.load();
    const ids: string[] = [];

    for (const { id, data } of entries) {
      const old = db[id];
      if (old) this._removeFromIndexes(id, old);
      db[id] = data;
      this._addToIndexes(id, data);
      ids.push(id);
    }

    this.save(db);
    this._stats.writes += entries.length;
    this._stats.batchOps++;

    this._emitChange({
      type: "batch",
      id: "*",
      ids,
      timestamp: Date.now(),
    });

    return entries.length;
  }

  /**
   * Массовое частичное обновление.
   * @returns Количество обновлённых (пропускает несуществующие)
   */
  updateMany(updates: BatchUpdateEntry<T>[]): number {
    if (updates.length === 0) return 0;

    const db = this.load();
    let count = 0;
    const ids: string[] = [];

    for (const { id, data } of updates) {
      const item = db[id];
      if (!item) continue;

      this._removeFromIndexes(id, item);
      db[id] = this.deepMerge(item, data);
      this._addToIndexes(id, db[id]);
      ids.push(id);
      count++;
    }

    if (count > 0) {
      this.save(db);
      this._stats.writes += count;
      this._stats.batchOps++;
      this._emitChange({ type: "batch", id: "*", ids, timestamp: Date.now() });
    }

    return count;
  }

  /**
   * Массовое удаление по ID.
   * @returns Количество удалённых
   */
  deleteMany(ids: string[]): number {
    if (ids.length === 0) return 0;

    const db = this.load();
    let count = 0;
    const deletedIds: string[] = [];

    for (const id of ids) {
      if (!(id in db)) continue;
      this._removeFromIndexes(id, db[id]);
      this._clearTTLTimer(id);
      delete db[id];
      deletedIds.push(id);
      count++;
    }

    if (count > 0) {
      this.save(db);
      this._stats.writes += count;
      this._stats.batchOps++;
      this._emitChange({
        type: "batch",
        id: "*",
        ids: deletedIds,
        timestamp: Date.now(),
      });
    }

    return count;
  }

  /** Удалить все записи по предикату */
  deleteWhere(predicate: (id: string, data: T) => boolean): number {
    const toDelete = this.find(predicate).map(([id]) => id);
    return this.deleteMany(toDelete);
  }

  
  // АГРЕГАЦИЯ
  /** Группировка записей по ключу */
  groupBy<K extends string>(
    keyFn: (id: string, data: T) => K,
  ): Record<K, Array<{ id: string; data: T }>> {
    const result = {} as Record<K, Array<{ id: string; data: T }>>;
    for (const [id, data] of Object.entries(this.load())) {
      const key = keyFn(id, data as T);
      if (!result[key]) result[key] = [];
      result[key].push({ id, data: data as T });
    }
    return result;
  }

  /** Трансформация всех записей */
  map<R>(mapFn: (id: string, data: T) => R): R[] {
    return Object.entries(this.load()).map(([id, data]) =>
      mapFn(id, data as T),
    );
  }

  /** Свёртка всех записей */
  reduce<R>(reduceFn: (acc: R, id: string, data: T) => R, initial: R): R {
    let result = initial;
    for (const [id, data] of Object.entries(this.load())) {
      result = reduceFn(result, id, data as T);
    }
    return result;
  }

  /** Сумма по числовому полю */
  sumBy(fieldFn: (data: T) => number): number {
    return this.reduce((sum, _, data) => sum + fieldFn(data), 0);
  }

  /** Подсчёт по группам */
  countBy<K extends string>(
    keyFn: (id: string, data: T) => K,
  ): Record<K, number> {
    const result = {} as Record<K, number>;
    for (const [id, data] of Object.entries(this.load())) {
      const key = keyFn(id, data as T);
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  }

  /** Итерация без аллокации массива */
  forEach(callback: (id: string, data: T) => void): void {
    for (const [id, data] of Object.entries(this.load())) {
      callback(id, data as T);
    }
  }

  // СТАТИСТИКА
  getAccessStats(): Readonly<DBAccessStats> {
    return { ...this._stats };
  }

  resetStats(): void {
    this._stats = {
      reads: 0,
      writes: 0,
      cacheHits: 0,
      cacheMisses: 0,
      indexLookups: 0,
      batchOps: 0,
      ttlExpirations: 0,
      createdAt: Date.now(),
    };
  }

  /** Расширенный статус (base + indexes + TTL + stats) */
  getEnhancedStatus() {
    return {
      ...this.getStatus(),
      indexes: this._indexDefs.map((d) => ({
        name: d.name,
        unique: d.unique ?? false,
        keys: this._indexes.get(d.name)?.size ?? 0,
      })),
      ttlEntries: this._ttlMap.size,
      changeListeners: this._changeListeners.size,
      changeLogSize: this._changeLog.length,
      stats: this.getAccessStats(),
    };
  }

  
  // CLEANUP
  
  /** Полная очистка: flush, TTL, слушатели, реестр */
  destroy(): void {
    this.saveAll();
    this.stopTTLCleanup();

    for (const [id] of this._ttlMap) {
      this._clearTTLTimer(id);
    }

    this._changeListeners.clear();
    this._changeLog.length = 0;

    LocalDBRegistry.unregister(this.tag);
  }
}