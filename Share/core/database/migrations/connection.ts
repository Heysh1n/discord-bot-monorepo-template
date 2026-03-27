import {
  MongoClient,
  Db,
  Collection,
  MongoClientOptions,
  ServerApiVersion,
} from "mongodb";
import { EventEmitter } from "node:events";
import {
  MongoConnectionConfig,
  DEFAULT_CONNECTION_CONFIG,
  createConfigFromSettings,
  SyncDocument,
  ConnectionState,
  ConnectionStatus,
  ConnectionEvents,
  QueryOptions,
  AggregateResult,
} from "./types";
import { MongoDBConfig, DBLoggingConfig } from "@config/config";

// ═══════════════════════════════════════════════════════════
// TYPED EVENT EMITTER
// ═══════════════════════════════════════════════════════════

class TypedEmitter<Events extends object> {
  private emitter = new EventEmitter();

  on<K extends keyof Events>(
    event: K,
    listener: Events[K] extends (...args: any[]) => any ? Events[K] : never
  ): this {
    this.emitter.on(event as string, listener as any);
    return this;
  }

  off<K extends keyof Events>(
    event: K,
    listener: Events[K] extends (...args: any[]) => any ? Events[K] : never
  ): this {
    this.emitter.off(event as string, listener as any);
    return this;
  }

  once<K extends keyof Events>(
    event: K,
    listener: Events[K] extends (...args: any[]) => any ? Events[K] : never
  ): this {
    this.emitter.once(event as string, listener as any);
    return this;
  }

  emit<K extends keyof Events>(
    event: K,
    ...args: Events[K] extends (...args: infer A) => any ? A : never
  ): boolean {
    return this.emitter.emit(event as string, ...args);
  }

  removeAllListeners<K extends keyof Events>(event?: K): this {
    this.emitter.removeAllListeners(event as string);
    return this;
  }
}

// ═══════════════════════════════════════════════════════════
// ЛОГИРОВАНИЕ
// ═══════════════════════════════════════════════════════════

function logSync(message: string): void {
  if (DBLoggingConfig.logSync) {
    console.log(`[MONGO] ${message}`);
  }
}

function logSyncError(message: string): void {
  console.error(`[MONGO] ${message}`);
}

function logSyncWarn(message: string): void {
  console.warn(`[MONGO] ${message}`);
}

// ═══════════════════════════════════════════════════════════
// MONGODB CONNECTION MANAGER (SINGLETON)
// ═══════════════════════════════════════════════════════════

class MongoConnection extends TypedEmitter<ConnectionEvents> {
  private static instance: MongoConnection | null = null;

  private client: MongoClient | null = null;
  private db: Db | null = null;
  private collection: Collection<SyncDocument> | null = null;
  private config: MongoConnectionConfig | null = null;

  private connectionState: ConnectionState = "disconnected";
  private connectedAt: Date | null = null;
  private lastError: string | null = null;

  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_BASE_DELAY = 2000;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private constructor() {
    super();
  }

  // ═══════════════════════════════════════════════════════════
  // SINGLETON
  // ═══════════════════════════════════════════════════════════

  static getInstance(): MongoConnection {
    if (!MongoConnection.instance) {
      MongoConnection.instance = new MongoConnection();
    }
    return MongoConnection.instance;
  }

  // ═══════════════════════════════════════════════════════════
  // ПОДКЛЮЧЕНИЕ (ОБНОВЛЁННОЕ ДЛЯ MONGODB ATLAS)
  // ═══════════════════════════════════════════════════════════

  async connect(
    uri?: string,
    customConfig?: Partial<MongoConnectionConfig>
  ): Promise<boolean> {
    // Проверяем включена ли синхронизация в конфиге
    if (!MongoDBConfig.enabled) {
      logSyncWarn("⚠️ MongoDB синхронизация отключена в конфиге");
      return false;
    }

    const mongoUri = uri || process.env.MONGO_URI || process.env.DB_URI;

    if (!mongoUri) {
      logSyncWarn("⚠️ MONGO_URI/DB_URI не указан, синхронизация отключена");
      return false;
    }

    if (this.connectionState === "connected") {
      return true;
    }

    if (this.connectionState === "connecting") {
      return new Promise((resolve) => {
        const checkConnection = setInterval(() => {
          if (this.connectionState === "connected") {
            clearInterval(checkConnection);
            resolve(true);
          } else if (
            this.connectionState === "error" ||
            this.connectionState === "disconnected"
          ) {
            clearInterval(checkConnection);
            resolve(false);
          }
        }, 100);
      });
    }

    this.connectionState = "connecting";

    // Используем конфиг из настроек приложения
    const appConfig = createConfigFromSettings();
    this.config = {
      ...DEFAULT_CONNECTION_CONFIG,
      ...appConfig,
      ...customConfig,
      uri: mongoUri,
    };

    try {
      logSync("🔄 Подключение к MongoDB Atlas...");

      // 🆕 Опции для MongoDB Atlas с Server API
      const options: MongoClientOptions = {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
        serverSelectionTimeoutMS: this.config.serverSelectionTimeoutMs,
        connectTimeoutMS: this.config.connectTimeoutMs,
        maxPoolSize: this.config.maxPoolSize,
        minPoolSize: this.config.minPoolSize,
        retryWrites: true,
        retryReads: true,

        // 🆕 ИЗМЕНИТЬ ЭТИ СТРОКИ:
        tls: true,
        tlsAllowInvalidCertificates: true, // ← Временный фикс
        tlsAllowInvalidHostnames: true, // ← Временный фикс

        // УБРАТЬ эти строки:
        // ssl: true,
        // tlsAllowInvalidCertificates: false,
        // tlsAllowInvalidHostnames: false,
      };

      this.client = new MongoClient(mongoUri, options);
      this.setupClientEvents();

      await this.client.connect();

      // Ping для проверки подключения
      await this.client.db("admin").command({ ping: 1 });
      logSync("✅ Ping успешен!");

      this.db = this.client.db(this.config.dbName);
      this.collection = this.db.collection<SyncDocument>(
        this.config.collectionName
      );

      await this.ensureIndexes();

      this.connectionState = "connected";
      this.connectedAt = new Date();
      this.reconnectAttempts = 0;
      this.lastError = null;

      logSync(
        `✅ Подключено к MongoDB Atlas: ${this.config.dbName}/${this.config.collectionName}`
      );
      this.emit("connected");

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.connectionState = "error";
      this.lastError = errorMessage;

      logSyncError(`❌ Ошибка подключения: ${errorMessage}`);

      // 🆕 Дополнительная диагностика
      if (
        errorMessage.includes("querySrv") ||
        errorMessage.includes("ENOTFOUND")
      ) {
        logSyncError("💡 Проверьте:");
        logSyncError("   1. Интернет-соединение");
        logSyncError("   2. Правильность URI в .env");
        logSyncError("   3. DNS настройки (попробуйте Google DNS 8.8.8.8)");
        logSyncError("   4. Network Access в MongoDB Atlas (добавьте ваш IP)");
      }

      if (errorMessage.includes("Authentication failed")) {
        logSyncError(
          "💡 Неверный логин/пароль. Проверьте credentials в MongoDB Atlas"
        );
      }

      this.emit(
        "error",
        error instanceof Error ? error : new Error(errorMessage)
      );

      return false;
    }
  }

  private setupClientEvents(): void {
    if (!this.client) return;

    this.client.on("close", () => {
      if (this.connectionState === "connected") {
        logSyncWarn("⚠️ Соединение закрыто");
        this.connectionState = "disconnected";
        this.emit("disconnected", "Connection closed");
        this.scheduleReconnect();
      }
    });

    this.client.on("error", (error) => {
      logSyncError(`Ошибка: ${error.message}`);
      this.lastError = error.message;
      this.emit("error", error);
    });

    this.client.on("timeout", () => {
      logSyncWarn("⚠️ Timeout");
    });

    // 🆕 Дополнительные события для мониторинга
    this.client.on("serverHeartbeatFailed", (event) => {
      logSyncWarn(`⚠️ Heartbeat failed: ${event.failure?.message}`);
    });

    this.client.on("serverHeartbeatSucceeded", () => {
      // Можно логировать если нужно
    });
  }

  private async ensureIndexes(): Promise<void> {
    if (!this.collection) return;

    try {
      // Составной уникальный индекс
      await this.collection.createIndex(
        { path: 1, key: 1 },
        { unique: true, name: "path_key_unique" }
      );

      // Индекс для поиска по пути
      await this.collection.createIndex({ path: 1 }, { name: "path_idx" });

      // Индекс для частей пути (для wildcards)
      await this.collection.createIndex(
        { pathParts: 1 },
        { name: "pathParts_idx" }
      );

      // Индекс для сортировки по времени
      await this.collection.createIndex(
        { "meta.updatedAt": -1 },
        { name: "updatedAt_desc" }
      );

      // Индекс для поиска по источнику
      await this.collection.createIndex(
        { "meta.source": 1 },
        { name: "source_idx" }
      );

      logSync("📑 Индексы созданы");
    } catch (error) {
      // Индексы могут уже существовать - это нормально
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("already exists")) {
        logSyncWarn(`⚠️ Ошибка создания индексов: ${error}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RECONNECT
  // ═══════════════════════════════════════════════════════════

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      logSyncError(
        "❌ Превышено максимальное количество попыток переподключения"
      );
      this.connectionState = "error";
      this.emit("reconnectFailed");
      return;
    }

    this.connectionState = "reconnecting";
    this.reconnectAttempts++;

    const delay =
      this.RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1);

    logSync(
      `🔄 Переподключение через ${delay / 1000}с (${this.reconnectAttempts}/${
        this.MAX_RECONNECT_ATTEMPTS
      })`
    );
    this.emit(
      "reconnecting",
      this.reconnectAttempts,
      this.MAX_RECONNECT_ATTEMPTS
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        if (this.client) {
          try {
            await this.client.close(true);
          } catch {
            // Игнорируем ошибки закрытия
          }
          this.client = null;
          this.db = null;
          this.collection = null;
        }

        const connected = await this.connect();

        if (connected) {
          logSync("✅ Переподключение успешно");
          this.emit("reconnected");
        } else {
          this.scheduleReconnect();
        }
      } catch (error) {
        logSyncError(`❌ Ошибка переподключения: ${error}`);
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ═══════════════════════════════════════════════════════════
  // ОТКЛЮЧЕНИЕ
  // ═══════════════════════════════════════════════════════════

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      try {
        await this.client.close();
        logSync("🔌 Отключено от MongoDB Atlas");
      } catch (error) {
        logSyncError(`Ошибка отключения: ${error}`);
      }

      this.client = null;
      this.db = null;
      this.collection = null;
    }

    this.connectionState = "disconnected";
    this.connectedAt = null;
    this.emit("disconnected", "Manual disconnect");
  }

  // ═══════════════════════════════════════════════════════════
  // GETTERS
  // ═══════════════════════════════════════════════════════════

  getCollection(): Collection<SyncDocument> | null {
    return this.collection;
  }

  getDb(): Db | null {
    return this.db;
  }

  getClient(): MongoClient | null {
    return this.client;
  }

  isConnected(): boolean {
    return this.connectionState === "connected" && this.collection !== null;
  }

  getStatus(): ConnectionStatus {
    return {
      state: this.connectionState,
      connectedAt: this.connectedAt || undefined,
      lastError: this.lastError || undefined,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // HEALTH CHECK
  // ═══════════════════════════════════════════════════════════

  async ping(): Promise<number | null> {
    if (!this.db) return null;

    try {
      const start = Date.now();
      await this.db.command({ ping: 1 });
      return Date.now() - start;
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    latency: number | null;
    error?: string;
  }> {
    try {
      const latency = await this.ping();
      return { healthy: latency !== null, latency };
    } catch (error) {
      return {
        healthy: false,
        latency: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // QUERY HELPERS
  // ═══════════════════════════════════════════════════════════

  async query<T>(options: QueryOptions = {}): Promise<SyncDocument<T>[]> {
    if (!this.collection) return [];

    try {
      const filter: any = {};

      if (options.path) {
        if (options.path.includes("*")) {
          const regex = options.path
            .replace(/\*/g, "[^/]+")
            .replace(/\//g, "\\/");
          filter.path = { $regex: `^${regex}$` };
        } else {
          filter.path = options.path;
        }
      }

      if (options.keys?.length) {
        filter.key = { $in: options.keys };
      }

      if (options.source) {
        filter["meta.source"] = options.source;
      }

      let cursor = this.collection.find(filter);

      if (options.sort) {
        const sortOrder = options.sort.order === "asc" ? 1 : -1;
        cursor = cursor.sort({ [options.sort.field]: sortOrder });
      }

      if (options.skip) {
        cursor = cursor.skip(options.skip);
      }

      if (options.limit) {
        cursor = cursor.limit(options.limit);
      }

      return (await cursor.toArray()) as SyncDocument<T>[];
    } catch (error) {
      logSyncError(`Ошибка запроса: ${error}`);
      return [];
    }
  }

  async aggregate(pathPattern?: string): Promise<AggregateResult[]> {
    if (!this.collection) return [];

    try {
      const pipeline: any[] = [];

      if (pathPattern) {
        if (pathPattern.includes("*")) {
          const regex = pathPattern
            .replace(/\*/g, "[^/]+")
            .replace(/\//g, "\\/");
          pipeline.push({ $match: { path: { $regex: `^${regex}$` } } });
        } else {
          pipeline.push({ $match: { path: { $regex: `^${pathPattern}` } } });
        }
      }

      pipeline.push({
        $group: {
          _id: "$path",
          count: { $sum: 1 },
          sources: { $addToSet: "$meta.source" },
          lastUpdated: { $max: "$meta.updatedAt" },
        },
      });

      pipeline.push({
        $project: {
          path: "$_id",
          count: 1,
          sources: 1,
          lastUpdated: 1,
          _id: 0,
        },
      });

      pipeline.push({ $sort: { path: 1 } });

      return await this.collection
        .aggregate<AggregateResult>(pipeline)
        .toArray();
    } catch (error) {
      logSyncError(`Ошибка агрегации: ${error}`);
      return [];
    }
  }

  async getPathTree(): Promise<Map<string, number>> {
    if (!this.collection) return new Map();

    try {
      const results = await this.collection
        .aggregate([
          { $group: { _id: "$path", count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const tree = new Map<string, number>();
      for (const item of results) {
        tree.set(item._id, item.count);
      }
      return tree;
    } catch (error) {
      logSyncError(`Ошибка получения дерева: ${error}`);
      return new Map();
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ЭКСПОРТ
// ═══════════════════════════════════════════════════════════

export const MongoDB = MongoConnection.getInstance();
export { MongoConnection };
