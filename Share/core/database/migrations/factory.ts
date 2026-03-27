// src/models/sync/factory.ts

import { SyncClient } from "./syncClient";
import { MongoDB } from "./connection";
import { SyncClientConfig, QueryOptions, AggregateResult } from "./types";
import { MongoDBConfig } from "@config/config";

// ═══════════════════════════════════════════════════════════
// REGISTRY
// ═══════════════════════════════════════════════════════════

class SyncRegistry {
  private clients = new Map<string, SyncClient<any>>();

  register<T>(client: SyncClient<T>): void {
    this.clients.set(client.getPath(), client);
  }

  unregister(path: string): void {
    const client = this.clients.get(path);
    if (client) {
      client.destroy();
      this.clients.delete(path);
    }
  }

  get<T>(path: string): SyncClient<T> | undefined {
    return this.clients.get(path) as SyncClient<T> | undefined;
  }

  getAll(): SyncClient<any>[] {
    return Array.from(this.clients.values());
  }

  has(path: string): boolean {
    return this.clients.has(path);
  }

  clear(): void {
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
  }
}

const registry = new SyncRegistry();

// ═══════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════

export class SyncFactory {
  /**
   * Проверить включена ли синхронизация в конфиге
   */
  static isEnabled(): boolean {
    return MongoDBConfig.enabled;
  }

  /**
   * Подключиться к MongoDB
   */
  static async connect(uri?: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.log("[SYNC] ⚠️ MongoDB синхронизация отключена в конфиге");
      return false;
    }
    return MongoDB.connect(uri);
  }

  /**
   * Отключиться от MongoDB
   */
  static async disconnect(): Promise<void> {
    registry.clear();
    await MongoDB.disconnect();
  }

  /**
   * Создать клиент синхронизации
   */
  static create<T>(config: SyncClientConfig<T>): SyncClient<T> {
    if (registry.has(config.path)) {
      console.warn(`[SYNC] Клиент для ${config.path} уже существует`);
      return registry.get<T>(config.path)!;
    }

    const client = new SyncClient<T>(config);
    registry.register(client);

    // Автосинхронизация из конфига если не указан интервал
    if (config.autoSyncInterval === undefined && MongoDBConfig.autoSync.enabled) {
      client.startAutoSync(MongoDBConfig.autoSync.intervalMs);
    } else if (config.autoSyncInterval && config.autoSyncInterval > 0) {
      client.startAutoSync(config.autoSyncInterval);
    }

    return client;
  }

  /**
   * Получить существующий клиент
   */
  static get<T>(path: string): SyncClient<T> | undefined {
    return registry.get<T>(path);
  }

  /**
   * Получить все клиенты
   */
  static getAll(): SyncClient<any>[] {
    return registry.getAll();
  }

  /**
   * Удалить клиент
   */
  static destroy(path: string): void {
    registry.unregister(path);
  }

  /**
   * Синхронизировать все клиенты
   */
  static async syncAll(direction: "upload" | "download" | "both" = "both"): Promise<void> {
    const clients = registry.getAll();
    
    console.log(`[SYNC] 🔄 Синхронизация всех клиентов (${clients.length})...`);
    
    const results = await Promise.allSettled(
      clients.map((client) => client.sync({ direction }))
    );

    let success = 0;
    let failed = 0;

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.success) {
        success++;
      } else {
        failed++;
      }
    }

    console.log(`[SYNC] ✅ Завершено: ${success} успешно, ${failed} с ошибками`);
  }

  /**
   * Проверить подключение
   */
  static isConnected(): boolean {
    return MongoDB.isConnected();
  }

  /**
   * Получить статус подключения
   */
  static getConnectionStatus() {
    return MongoDB.getStatus();
  }

  /**
   * Health check
   */
  static async healthCheck() {
    return MongoDB.healthCheck();
  }

  /**
   * Запрос к MongoDB
   */
  static async query<T>(options: QueryOptions) {
    return MongoDB.query<T>(options);
  }

  /**
   * Агрегация
   */
  static async aggregate(pathPattern?: string): Promise<AggregateResult[]> {
    return MongoDB.aggregate(pathPattern);
  }

  /**
   * Дерево путей
   */
  static async getPathTree(): Promise<Map<string, number>> {
    return MongoDB.getPathTree();
  }

  /**
   * Подписка на события подключения
   */
  static on = MongoDB.on.bind(MongoDB);
  static off = MongoDB.off.bind(MongoDB);
  static once = MongoDB.once.bind(MongoDB);
}