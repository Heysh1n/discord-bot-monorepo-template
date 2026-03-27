// src/models/sync/syncClient.ts

import { Collection, BulkWriteOptions } from "mongodb";
import { EventEmitter } from "node:events";
import { MongoDB } from "./connection";
import {
  SyncClientConfig,
  SyncDocument,
  SyncMeta,
  SyncOptions,
  SyncResult,
  SyncError,
  SyncStats,
  ClientStatus,
  SyncClientEvents,
  LocalDBAdapter,
  BackupInfo,
  BackupDocument,
  RestoreResult,
} from "./types";
import { createChecksum, generateDocumentId, parsePath } from "./utils";
import { DBLoggingConfig } from "@config/config";
import {
  log,
  logError,
  logWarn,
} from "@common/decorators/logFunction.decorator";

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

  emit<K extends keyof Events>(
    event: K,
    ...args: Events[K] extends (...args: infer A) => any ? A : never
  ): boolean {
    return this.emitter.emit(event as string, ...args);
  }

  removeAllListeners(): this {
    this.emitter.removeAllListeners();
    return this;
  }
}

// ═══════════════════════════════════════════════════════════
// SYNC CLIENT
// ═══════════════════════════════════════════════════════════

export class SyncClient<T> extends TypedEmitter<SyncClientEvents<T>> {
  readonly path: string;
  readonly pathParts: string[];
  readonly source: string;

  private localDB: LocalDBAdapter<T>;
  private validator?: (data: unknown) => data is T;
  private repairer?: (data: Partial<T>, key: string) => T;

  private syncInterval: NodeJS.Timeout | null = null;
  private syncIntervalMs: number;
  private lastSyncTime: Date | null = null;

  private stats: SyncStats = {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    totalUploaded: 0,
    totalDownloaded: 0,
  };

  // Имя для логов (короткое)
  private readonly logName: string;

  constructor(config: SyncClientConfig<T>) {
    super();

    this.path = this.normalizePath(config.path);
    this.pathParts = parsePath(this.path);
    this.source = config.source;
    this.localDB = config.localDB;
    this.validator = config.validator;
    this.repairer = config.repairer;
    this.syncIntervalMs = config.autoSyncInterval || 0;

    // Короткое имя для логов: "Staff/LowStaff/supports" -> "SYNC_SUPPORTS"
    this.logName = `SYNC_${
      this.pathParts[this.pathParts.length - 1]?.toUpperCase() || "DATA"
    }`;

    if (DBLoggingConfig.logSync) {
      log(this.logName, `📁 Клиент создан (путь: ${this.path})`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  private normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  }

  private getCollection(): Collection<SyncDocument<T>> | null {
    return MongoDB.getCollection() as Collection<SyncDocument<T>> | null;
  }

  private createDocument(
    key: string,
    value: T,
    existingMeta?: SyncMeta
  ): SyncDocument<T> {
    const now = new Date();

    return {
      _id: generateDocumentId(this.path, key),
      path: this.path,
      pathParts: this.pathParts,
      key,
      value,
      meta: {
        syncedAt: now,
        source: this.source,
        version: (existingMeta?.version || 0) + 1,
        updatedAt: now,
        createdAt: existingMeta?.createdAt || now,
        checksum: createChecksum(value),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // СИНХРОНИЗАЦИЯ
  // ═══════════════════════════════════════════════════════════

  async sync(
    options: SyncOptions = { direction: "both" }
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      path: this.path,
      uploaded: 0,
      downloaded: 0,
      skipped: 0,
      deleted: 0,
      errors: [],
      timestamp: new Date(),
      duration: 0,
    };

    if (!MongoDB.isConnected()) {
      result.errors.push({
        operation: "connect",
        message: "Нет подключения к MongoDB",
        timestamp: new Date(),
      });
      return result;
    }

    this.stats.totalSyncs++;
    this.emit("syncStarted", options);

    try {
      if (DBLoggingConfig.logSync) {
        log(this.logName, `🔄 Синхронизация (${options.direction})...`);
      }

      if (options.direction === "upload" || options.direction === "both") {
        const uploadResult = await this.upload(options);
        result.uploaded = uploadResult.uploaded;
        result.skipped += uploadResult.skipped;
        result.errors.push(...uploadResult.errors);
      }

      if (options.direction === "download" || options.direction === "both") {
        const downloadResult = await this.download(options);
        result.downloaded = downloadResult.downloaded;
        result.skipped += downloadResult.skipped;
        result.errors.push(...downloadResult.errors);
      }

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      if (result.success) {
        this.stats.successfulSyncs++;
      } else {
        this.stats.failedSyncs++;
      }

      this.stats.totalUploaded += result.uploaded;
      this.stats.totalDownloaded += result.downloaded;
      this.stats.lastSyncAt = new Date();
      this.lastSyncTime = new Date();

      if (DBLoggingConfig.logSync) {
        log(
          this.logName,
          `✅ Завершено: ↑${result.uploaded} ↓${result.downloaded} (${result.duration}мс)`
        );
      }

      this.emit("syncCompleted", result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      result.errors.push({
        operation: "connect",
        message: errorMessage,
        timestamp: new Date(),
      });
      result.duration = Date.now() - startTime;
      this.stats.failedSyncs++;

      logError(this.logName, `❌ Ошибка: ${errorMessage}`);
      this.emit(
        "syncFailed",
        error instanceof Error ? error : new Error(errorMessage)
      );
    }

    return result;
  }

  private async upload(options: SyncOptions): Promise<{
    uploaded: number;
    skipped: number;
    errors: SyncError[];
  }> {
    const collection = this.getCollection();
    if (!collection) return { uploaded: 0, skipped: 0, errors: [] };

    const localData = this.localDB.getAll();
    const keys = options.keys || Object.keys(localData);

    let uploaded = 0;
    let skipped = 0;
    const errors: SyncError[] = [];

    const existingDocs = await collection
      .find({ path: this.path, key: { $in: keys } })
      .toArray();

    const existingMap = new Map(existingDocs.map((doc) => [doc.key, doc]));
    const bulkOps: any[] = [];

    for (const key of keys) {
      const localValue = localData[key];
      if (localValue === undefined) {
        skipped++;
        continue;
      }

      try {
        if (this.validator && !this.validator(localValue)) {
          errors.push({
            key,
            operation: "validate",
            message: "Данные не прошли валидацию",
            timestamp: new Date(),
          });
          continue;
        }

        const existing = existingMap.get(key);

        if (!options.force && existing) {
          const localChecksum = createChecksum(localValue);
          if (existing.meta.checksum === localChecksum) {
            skipped++;
            continue;
          }
        }

        const doc = this.createDocument(key, localValue, existing?.meta);

        if (options.dryRun) {
          uploaded++;
          continue;
        }

        bulkOps.push({
          replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true,
          },
        });

        uploaded++;
        this.emit("itemSynced", key, "up", localValue);
      } catch (error) {
        errors.push({
          key,
          operation: "upload",
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
      }
    }

    if (bulkOps.length > 0 && !options.dryRun) {
      try {
        const bulkOptions: BulkWriteOptions = { ordered: false };
        await collection.bulkWrite(bulkOps, bulkOptions);
      } catch (error) {
        logError(this.logName, `Ошибка bulk upload: ${error}`);
      }
    }

    return { uploaded, skipped, errors };
  }

  private async download(options: SyncOptions): Promise<{
    downloaded: number;
    skipped: number;
    errors: SyncError[];
  }> {
    const collection = this.getCollection();
    if (!collection) return { downloaded: 0, skipped: 0, errors: [] };

    let downloaded = 0;
    let skipped = 0;
    const errors: SyncError[] = [];

    const filter: any = { path: this.path };
    if (options.keys?.length) {
      filter.key = { $in: options.keys };
    }

    const remoteDocs = await collection.find(filter).toArray();

    if (DBLoggingConfig.logSync) {
      log(this.logName, `📥 Найдено ${remoteDocs.length} документов в MongoDB`);
    }

    for (const doc of remoteDocs) {
      try {
        const key = doc.key;
        const remoteValue = doc.value;
        const localValue = this.localDB.get(key);

        // 🆕 ИСПРАВЛЕНО: force проверяется ПЕРВОЙ
        if (options.force) {
          // Принудительная загрузка - пропускаем все проверки
          if (DBLoggingConfig.logSync) {
            log(this.logName, `  ⬇️ [FORCE] ${key}`);
          }
        } else if (localValue) {
          // Проверка checksum только если НЕ force
          const localChecksum = createChecksum(localValue);
          if (doc.meta.checksum === localChecksum) {
            skipped++;
            continue;
          }

        }

        // Валидация
        if (this.validator && !this.validator(remoteValue)) {
          if (this.repairer) {
            const repaired = this.repairer(remoteValue as Partial<T>, key);
            if (!options.dryRun) {
              this.localDB.set(key, repaired);
            }
            downloaded++;
            this.emit("itemSynced", key, "down", repaired);

            if (DBLoggingConfig.logSync) {
              logWarn(this.logName, `  🔧 Восстановлено: ${key}`);
            }
            continue;
          }

          errors.push({
            key,
            operation: "validate",
            message: "Удалённые данные не прошли валидацию",
            timestamp: new Date(),
          });
          continue;
        }

        if (options.dryRun) {
          downloaded++;
          continue;
        }

        // Сохраняем в локальную БД
        if (this.localDB.update) {
          this.localDB.update(key, remoteValue);
        } else {
          this.localDB.set(key, remoteValue);
        }

        console.log(`[DEBUG] Set ${key}, проверка:`, this.localDB.get(key) ? "✅ есть" : "❌ нет");
        
        downloaded++;
        this.emit("itemSynced", key, "down", remoteValue);

        if (DBLoggingConfig.logSync) {
          log(this.logName, `  ✅ Загружено: ${key}`);
        }
      } catch (error) {
        errors.push({
          key: doc.key,
          operation: "download",
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
      }
    }

    return { downloaded, skipped, errors };
  }

  // ═══════════════════════════════════════════════════════════
  // АВТОСИНХРОНИЗАЦИЯ
  // ═══════════════════════════════════════════════════════════

  startAutoSync(intervalMs?: number): void {
    this.stopAutoSync();

    const interval = intervalMs || this.syncIntervalMs;
    if (interval <= 0) return;

    this.syncIntervalMs = interval;

    this.sync({ direction: "both" }).catch((error) => {
      logError(this.logName, `Ошибка начальной синхронизации: ${error}`);
    });

    this.syncInterval = setInterval(async () => {
      if (MongoDB.isConnected()) {
        await this.sync({ direction: "upload" });
      }
    }, interval);

    if (DBLoggingConfig.logSync) {
      log(this.logName, `⏰ Автосинхронизация запущена (${interval / 1000}с)`);
    }
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      if (DBLoggingConfig.logSync) {
        log(this.logName, `⏹️ Автосинхронизация остановлена`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ОДИНОЧНЫЕ ОПЕРАЦИИ
  // ═══════════════════════════════════════════════════════════

  async syncOne(key: string): Promise<boolean> {
    const collection = this.getCollection();
    if (!collection) return false;

    try {
      const localValue = this.localDB.get(key);
      if (!localValue) return false;

      const existing = await collection.findOne({ path: this.path, key });
      const doc = this.createDocument(key, localValue, existing?.meta);

      await collection.replaceOne({ _id: doc._id }, doc, { upsert: true });

      if (DBLoggingConfig.logSync) {
        log(this.logName, `✅ Синхронизирован: ${key}`);
      }

      this.emit("itemSynced", key, "up", localValue);
      return true;
    } catch (error) {
      logError(this.logName, `❌ Ошибка синхронизации ${key}: ${error}`);
      return false;
    }
  }

  async deleteOne(key: string): Promise<boolean> {
    const collection = this.getCollection();
    if (!collection) return false;

    try {
      const result = await collection.deleteOne({ path: this.path, key });
      if (result.deletedCount > 0) {
        if (DBLoggingConfig.logSync) {
          log(this.logName, `🗑️ Удалён: ${key}`);
        }
        this.emit("itemDeleted", key);
      }
      return result.deletedCount > 0;
    } catch (error) {
      logError(this.logName, `❌ Ошибка удаления ${key}: ${error}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // БЭКАПЫ
  // ═══════════════════════════════════════════════════════════

  async createBackup(reason?: string): Promise<BackupInfo | null> {
    const db = MongoDB.getDb();
    if (!db) return null;

    try {
      const backupId = `backup_${this.path.replace(/\//g, "_")}_${Date.now()}`;
      const backupCollection = db.collection<BackupDocument<T>>(backupId);

      const localData = this.localDB.getAll();
      const docs: BackupDocument<T>[] = [];

      for (const [key, value] of Object.entries(localData)) {
        docs.push({
          _id: `${backupId}:${key}`,
          backupId,
          originalPath: this.path,
          key,
          value: value as T,
          originalMeta: {
            syncedAt: new Date(),
            source: this.source,
            version: 1,
            updatedAt: new Date(),
            createdAt: new Date(),
          },
          backupAt: new Date(),
          reason,
        });
      }

      if (docs.length > 0) {
        await backupCollection.insertMany(docs);
      }

      const info: BackupInfo = {
        id: backupId,
        path: this.path,
        timestamp: new Date(),
        count: docs.length,
        source: this.source,
        reason,
      };

      if (DBLoggingConfig.logSync) {
        log(this.logName, `📦 Бэкап создан: ${docs.length} записей`);
      }

      return info;
    } catch (error) {
      logError(this.logName, `❌ Ошибка бэкапа: ${error}`);
      return null;
    }
  }

  async restoreFromBackup(
    backupId: string,
    overwrite = false
  ): Promise<RestoreResult> {
    const result: RestoreResult = {
      success: false,
      restored: 0,
      skipped: 0,
      errors: [],
    };

    const db = MongoDB.getDb();
    if (!db) {
      result.errors.push({
        operation: "connect",
        message: "Нет подключения к MongoDB",
        timestamp: new Date(),
      });
      return result;
    }

    try {
      const backupCollection = db.collection<BackupDocument<T>>(backupId);
      const docs = await backupCollection
        .find({ originalPath: this.path })
        .toArray();

      if (docs.length === 0) {
        result.errors.push({
          operation: "download",
          message: `Бэкап ${backupId} не найден`,
          timestamp: new Date(),
        });
        return result;
      }

      for (const doc of docs) {
        try {
          const existingLocal = this.localDB.get(doc.key);

          if (!overwrite && existingLocal) {
            result.skipped++;
            continue;
          }

          this.localDB.set(doc.key, doc.value);
          result.restored++;
        } catch (error) {
          result.errors.push({
            key: doc.key,
            operation: "download",
            message: error instanceof Error ? error.message : String(error),
            timestamp: new Date(),
          });
        }
      }

      result.success = result.errors.length === 0;

      if (DBLoggingConfig.logSync) {
        log(
          this.logName,
          `♻️ Восстановлено: ${result.restored}, пропущено: ${result.skipped}`
        );
      }

      return result;
    } catch (error) {
      result.errors.push({
        operation: "download",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
      return result;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // СТАТУС
  // ═══════════════════════════════════════════════════════════

  async getStatus(): Promise<ClientStatus> {
    const collection = this.getCollection();
    let remoteCount = 0;

    if (collection) {
      try {
        remoteCount = await collection.countDocuments({ path: this.path });
      } catch {}
    }

    const localCount = Object.keys(this.localDB.getAll()).length;

    return {
      path: this.path,
      source: this.source,
      connected: MongoDB.isConnected(),
      autoSync: {
        enabled: this.syncInterval !== null,
        intervalMs: this.syncIntervalMs,
        lastSync: this.lastSyncTime || undefined,
        nextSync:
          this.syncInterval && this.lastSyncTime
            ? new Date(this.lastSyncTime.getTime() + this.syncIntervalMs)
            : undefined,
      },
      stats: { ...this.stats },
      counts: {
        local: localCount,
        remote: remoteCount,
      },
    };
  }

  getPath(): string {
    return this.path;
  }

  getSource(): string {
    return this.source;
  }

  destroy(): void {
    this.stopAutoSync();
    this.removeAllListeners();
    if (DBLoggingConfig.logSync) {
      log(this.logName, `🔌 Клиент уничтожен`);
    }
  }
}
