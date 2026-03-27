import fs from "fs";
import path from "path";
import { getBotPaths } from "@share/constants.js";
import {
  logInfo,
  logError,
  logDebug,
  logWarn,
} from "../../functions/logSave.function.js";


// ТИПЫ
/** Конфигурация SmartCache */
export interface CacheConfig {
  /** Максимум записей (0 = безлимит) */
  maxSize: number;
  /** TTL по умолчанию в мс (0 = без TTL) */
  defaultTTL: number;
  /** Интервал фоновой очистки просроченных (мс) */
  cleanupIntervalMs: number;
  /** Путь для persistence (null = только память) */
  persistPath: string | null;
  /** Интервал записи на диск (мс) */
  persistIntervalMs: number;
  /** Колбэк при вытеснении записи */
  onEvict?: (key: string, value: unknown) => void;
}

/** Внутренняя запись кэша */
interface CacheEntry<V> {
  /** Значение */
  v: V;
  /** Создано (timestamp) */
  c: number;
  /** Последний доступ (timestamp) */
  a: number;
  /** Сколько раз обращались */
  n: number;
  /** Когда истекает (null = бессрочно) */
  e: number | null;
}

/** Сериализуемая запись (для persistence) */
interface SerializedEntry<V> {
  k: string;
  v: V;
  e: number | null;
}

/** Статистика кэша */
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  expired: number;
  hitRate: number;
  size: number;
  maxSize: number;
  persistWrites: number;
  uptime: number;
}


// ДЕФОЛТНАЯ КОНФИГУРАЦИЯ
const DEFAULT_CONFIG: CacheConfig = {
  maxSize: 1000,
  defaultTTL: 0,
  cleanupIntervalMs: 60_000,
  persistPath: null,
  persistIntervalMs: 30_000,
};

//  SMART CACHE

//
//  LRU-кэш с TTL, опциональной persistence и статистикой.
//
//  LRU реализован через Map (сохраняет порядок вставки):
//    • get() — delete + set (перемещает запись в конец = "самая свежая")
//    • eviction — итерация с начала Map = "самые старые" записи
//
//  TTL:
//    • Per-entry или default
//    • Lazy-проверка на get() + периодическая фоновая очистка
//    • Без индивидуальных setTimeout (экономия ресурсов)
//
//  Persistence:
//    • Опциональная запись на диск (JSON)
//    • Загрузка при создании
//    • Фильтрация просроченных при загрузке
//
//  Использование:
//
//    const cache = new SmartCache<UserProfile>("user-profiles", {
//      maxSize: 500,
//      defaultTTL: 5 * 60_000,                    // 5 мин
//      persistPath: "data/cache/profiles.json",    // опционально
//    });
//
//    // Простое использование
//    cache.set("user:123", profileData);
//    const profile = cache.get("user:123");
//
//    // Cache-aside: если нет — вычислить и закэшировать
//    const data = cache.getOrSet("user:456", () => fetchProfile("456"));
//
//    // Async
//    const data = await cache.getOrSetAsync("user:789", () => api.getUser("789"));
//


export class SmartCache<V = unknown> {
  readonly name: string;
  private store: Map<string, CacheEntry<V>>;
  private config: CacheConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private createdAt: number;

  // ─── Статистика 
  private _hits = 0;
  private _misses = 0;
  private _sets = 0;
  private _deletes = 0;
  private _evictions = 0;
  private _expired = 0;
  private _persistWrites = 0;

  constructor(name: string, config?: Partial<CacheConfig>) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new Map();
    this.createdAt = Date.now();

    // Загружаем с диска если настроена persistence
    if (this.config.persistPath) {
      this._restore();
    }

    // Запускаем фоновую очистку
    if (this.config.cleanupIntervalMs > 0) {
      this._startCleanup();
    }

    // Запускаем периодическую запись на диск
    if (this.config.persistPath && this.config.persistIntervalMs > 0) {
      this._startPersist();
    }
  }

  // CORE — get / set / has / delete / clear
  /**
   * Получить значение. Возвращает undefined если нет или просрочено.
   * Обновляет LRU-позицию.
   */
  get(key: string): V | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Проверка TTL
    if (entry.e !== null && entry.e <= Date.now()) {
      this.store.delete(key);
      this._expired++;
      this._misses++;
      return undefined;
    }

    // LRU: перемещаем в конец (= most recently used)
    this.store.delete(key);
    entry.a = Date.now();
    entry.n++;
    this.store.set(key, entry);

    this._hits++;
    return entry.v;
  }

  /**
   * Записать значение.
   * @param key Ключ
   * @param value Значение
   * @param ttlMs TTL в мс (если не указан — используется defaultTTL)
   */
  set(key: string, value: V, ttlMs?: number): void {
    // Если ключ уже есть — удаляем (чтобы переместить в конец Map)
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Eviction: если достигнут лимит
    if (this.config.maxSize > 0 && this.store.size >= this.config.maxSize) {
      this._evictOne();
    }

    const ttl = ttlMs ?? this.config.defaultTTL;
    const now = Date.now();

    const entry: CacheEntry<V> = {
      v: value,
      c: now,
      a: now,
      n: 0,
      e: ttl > 0 ? now + ttl : null,
    };

    this.store.set(key, entry);
    this._sets++;
    this.dirty = true;
  }

  /** Проверить наличие (с учётом TTL) */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (entry.e !== null && entry.e <= Date.now()) {
      this.store.delete(key);
      this._expired++;
      return false;
    }

    return true;
  }

  /** Удалить запись */
  delete(key: string): boolean {
    const deleted = this.store.delete(key);
    if (deleted) {
      this._deletes++;
      this.dirty = true;
    }
    return deleted;
  }

  /** Очистить весь кэш */
  clear(): void {
    this._deletes += this.store.size;
    this.store.clear();
    this.dirty = true;
  }

  // SMART PATTERNS
  /**
   * Получить или вычислить (cache-aside pattern).
   * Если значения нет или просрочено — вызывает factory(), кэширует и возвращает.
   *
   * @example
   * const user = cache.getOrSet(`user:${id}`, () => db.getUser(id), 5 * 60_000);
   */
  getOrSet(key: string, factory: () => V, ttlMs?: number): V {
    const existing = this.get(key);
    if (existing !== undefined) return existing;

    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Async-версия getOrSet.
   *
   * @example
   * const data = await cache.getOrSetAsync("api:stats", () => fetch("/api/stats"), 60_000);
   */
  async getOrSetAsync(
    key: string,
    factory: () => Promise<V>,
    ttlMs?: number,
  ): Promise<V> {
    const existing = this.get(key);
    if (existing !== undefined) return existing;

    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Обновить значение in-place (если существует).
   * @returns Обновлённое значение или undefined
   */
  patch(key: string, updater: (current: V) => V): V | undefined {
    const current = this.get(key);
    if (current === undefined) return undefined;

    const updated = updater(current);
    // Сохраняем с тем же TTL
    const entry = this.store.get(key);
    const remainingTTL =
      entry?.e !== null && entry?.e !== undefined
        ? Math.max(0, entry.e - Date.now())
        : undefined;
    this.set(key, updated, remainingTTL);
    return updated;
  }

  // TTL MANAGEMENT
  /** Сбросить TTL (обновить время жизни от текущего момента) */
  touch(key: string, ttlMs?: number): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (entry.e !== null && entry.e <= Date.now()) {
      this.store.delete(key);
      this._expired++;
      return false;
    }

    const ttl = ttlMs ?? this.config.defaultTTL;
    if (ttl > 0) {
      entry.e = Date.now() + ttl;
    }
    entry.a = Date.now();
    return true;
  }

  /** Оставшееся TTL в мс (null = нет TTL, 0 = истекло) */
  getRemainingTTL(key: string): number | null {
    const entry = this.store.get(key);
    if (!entry || entry.e === null) return null;
    return Math.max(0, entry.e - Date.now());
  }

  // BULK-ОПЕРАЦИИ
  /** Получить несколько значений */
  getMany(keys: string[]): Map<string, V> {
    const result = new Map<string, V>();
    for (const key of keys) {
      const value = this.get(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }
    return result;
  }

  /** Записать несколько значений */
  setMany(entries: Array<[string, V]>, ttlMs?: number): void {
    for (const [key, value] of entries) {
      this.set(key, value, ttlMs);
    }
  }

  /** Удалить все ключи с указанным префиксом */
  deleteByPrefix(prefix: string): number {
    let count = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this._deletes += count;
      this.dirty = true;
    }
    return count;
  }

  /** Удалить все записи по предикату */
  deleteByPredicate(fn: (key: string, value: V) => boolean): number {
    let count = 0;
    for (const [key, entry] of this.store) {
      if (fn(key, entry.v)) {
        this.store.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this._deletes += count;
      this.dirty = true;
    }
    return count;
  }

  // INFO
  /** Текущий размер кэша */
  get size(): number {
    return this.store.size;
  }

  /** Максимальный размер */
  get capacity(): number {
    return this.config.maxSize;
  }

  /** Все ключи (без проверки TTL) */
  keys(): string[] {
    return [...this.store.keys()];
  }

  /** Все валидные значения (с проверкой TTL) */
  values(): V[] {
    const now = Date.now();
    const result: V[] = [];
    for (const [key, entry] of this.store) {
      if (entry.e !== null && entry.e <= now) {
        this.store.delete(key);
        this._expired++;
        continue;
      }
      result.push(entry.v);
    }
    return result;
  }

  /** Все валидные пары [key, value] */
  entries(): Array<[string, V]> {
    const now = Date.now();
    const result: Array<[string, V]> = [];
    for (const [key, entry] of this.store) {
      if (entry.e !== null && entry.e <= now) {
        this.store.delete(key);
        this._expired++;
        continue;
      }
      result.push([key, entry.v]);
    }
    return result;
  }

  // STATISTICS
  getStats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      sets: this._sets,
      deletes: this._deletes,
      evictions: this._evictions,
      expired: this._expired,
      hitRate: total > 0 ? this._hits / total : 0,
      size: this.store.size,
      maxSize: this.config.maxSize,
      persistWrites: this._persistWrites,
      uptime: Date.now() - this.createdAt,
    };
  }

  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
    this._sets = 0;
    this._deletes = 0;
    this._evictions = 0;
    this._expired = 0;
    this._persistWrites = 0;
  }

  // LRU EVICTION (внутреннее)
  private _evictOne(): void {
    const firstKey = this.store.keys().next().value;
    if (firstKey === undefined) return;

    const entry = this.store.get(firstKey);
    this.store.delete(firstKey);
    this._evictions++;

    if (this.config.onEvict && entry) {
      try {
        this.config.onEvict(firstKey, entry.v);
      } catch {
        // Ignore callback errors
      }
    }
  }

  // TTL CLEANUP (фоновая очистка)
  private _startCleanup(): void {
    this.cleanupTimer = setInterval(() => this._cleanup(), this.config.cleanupIntervalMs);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  private _cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.store) {
      if (entry.e !== null && entry.e <= now) {
        this.store.delete(key);
        this._expired++;
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.dirty = true;
      logDebug(`CACHE:${this.name}`, `🧹 Cleaned ${cleaned} expired entries`);
    }
  }

  // PERSISTENCE (опциональная запись на диск)
  private _getFullPersistPath(): string | null {
    if (!this.config.persistPath) return null;

    // Если абсолютный путь — используем как есть
    if (path.isAbsolute(this.config.persistPath)) {
      return this.config.persistPath;
    }

    // Иначе — относительно BotPaths.cache
    try {
      return path.join(getBotPaths().cache, this.config.persistPath);
    } catch {
      return this.config.persistPath;
    }
  }

  private _startPersist(): void {
    this.persistTimer = setInterval(() => {
      if (this.dirty) this.persist();
    }, this.config.persistIntervalMs);
    if (this.persistTimer.unref) this.persistTimer.unref();
  }

  /** Сохранить кэш на диск (только валидные записи) */
  persist(): void {
    const filePath = this._getFullPersistPath();
    if (!filePath) return;

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const now = Date.now();
      const data: SerializedEntry<V>[] = [];

      for (const [key, entry] of this.store) {
        // Пропускаем просроченные
        if (entry.e !== null && entry.e <= now) continue;
        data.push({ k: key, v: entry.v, e: entry.e });
      }

      fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");
      this.dirty = false;
      this._persistWrites++;

      logDebug(`CACHE:${this.name}`, `💾 Persisted ${data.length} entries`);
    } catch (err) {
      logError(`CACHE:${this.name}`, `Persist failed: ${err}`);
    }
  }

  /** Загрузить кэш с диска */
  private _restore(): void {
    const filePath = this._getFullPersistPath();
    if (!filePath || !fs.existsSync(filePath)) return;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data: SerializedEntry<V>[] = JSON.parse(raw);
      const now = Date.now();
      let loaded = 0;
      let skipped = 0;

      for (const { k, v, e } of data) {
        // Пропускаем просроченные
        if (e !== null && e <= now) {
          skipped++;
          continue;
        }

        // Не превышаем maxSize
        if (this.config.maxSize > 0 && this.store.size >= this.config.maxSize) {
          break;
        }

        this.store.set(k, {
          v,
          c: now,
          a: now,
          n: 0,
          e,
        });
        loaded++;
      }

      logInfo(
        `CACHE:${this.name}`,
        `📂 Restored ${loaded} entries (${skipped} expired, skipped)`,
      );
    } catch (err) {
      logWarn(`CACHE:${this.name}`, `Restore failed: ${err}`);
    }
  }

  // LIFECYCLE
  /** Полная остановка: persist → clear timers */
  destroy(): void {
    // Сохраняем на диск если настроено
    if (this.config.persistPath && this.dirty) {
      this.persist();
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    this.store.clear();

    // Убираем из реестра
    CacheManager.remove(this.name);
  }
}


//  CACHE MANAGER — Singleton-реестр всех кэшей
class CacheManagerImpl {
  private caches = new Map<string, SmartCache<any>>();

  /**
   * Создать и зарегистрировать новый кэш.
   * Если кэш с таким именем уже есть — возвращает существующий.
   */
  create<V>(name: string, config?: Partial<CacheConfig>): SmartCache<V> {
    if (this.caches.has(name)) {
      return this.caches.get(name)! as SmartCache<V>;
    }
    const cache = new SmartCache<V>(name, config);
    this.caches.set(name, cache);
    return cache;
  }

  /** Получить существующий кэш */
  get<V>(name: string): SmartCache<V> | undefined {
    return this.caches.get(name) as SmartCache<V> | undefined;
  }

  has(name: string): boolean {
    return this.caches.has(name);
  }

  /** Убрать кэш из реестра (без destroy) */
  remove(name: string): void {
    this.caches.delete(name);
  }

  /** Уничтожить кэш */
  destroy(name: string): void {
    const cache = this.caches.get(name);
    if (cache) {
      cache.destroy();
      // destroy() вызовет remove() через CacheManager.remove()
    }
  }

  /** Уничтожить все кэши */
  destroyAll(): void {
    for (const cache of this.caches.values()) {
      cache.destroy();
    }
    this.caches.clear();
  }

  /** Persist все кэши */
  persistAll(): void {
    for (const cache of this.caches.values()) {
      cache.persist();
    }
  }

  /** Очистить все кэши (без уничтожения) */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }

  /** Статистика всех кэшей */
  statsAll(): Record<string, CacheStats> {
    const result: Record<string, CacheStats> = {};
    for (const [name, cache] of this.caches) {
      result[name] = cache.getStats();
    }
    return result;
  }

  /** Все имена кэшей */
  names(): string[] {
    return [...this.caches.keys()];
  }

  get size(): number {
    return this.caches.size;
  }
}

export const CacheManager = new CacheManagerImpl();


//  BACKWARD COMPATIBILITY — ActionCache
//  Теперь: SmartCache<string> с persistence

let _actionCache: SmartCache<string> | null = null;

export function getActionCache(): SmartCache<string> {
  if (!_actionCache) {
    _actionCache = CacheManager.create<string>("action-cache", {
      maxSize: 10_000,
      defaultTTL: 24 * 60 * 60_000, // 24 часа
      persistPath: "cache.json",
      persistIntervalMs: 30_000,
      cleanupIntervalMs: 5 * 60_000,
    });
  }
  return _actionCache;
}

export const ActionCache = new Proxy({} as SmartCache<string>, {
  get(_, prop) {
    return Reflect.get(getActionCache(), prop);
  },
});