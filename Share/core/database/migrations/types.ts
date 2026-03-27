// src/models/sync/types.ts

import { MongoDBConfig } from "@config/config";

// ═══════════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ ПОДКЛЮЧЕНИЯ
// ═══════════════════════════════════════════════════════════

export interface MongoConnectionConfig {
  uri: string;
  dbName: string;
  collectionName: string;
  connectTimeoutMs: number;
  serverSelectionTimeoutMs: number;
  maxPoolSize: number;
  minPoolSize: number;
}

/**
 * Создать конфиг из настроек приложения
 */
export function createConfigFromSettings(): Omit<MongoConnectionConfig, "uri"> {
  return {
    dbName: MongoDBConfig.database,
    collectionName: MongoDBConfig.collection,
    connectTimeoutMs: MongoDBConfig.connectionTimeout,
    serverSelectionTimeoutMs: MongoDBConfig.serverSelectionTimeout,
    maxPoolSize: 20,
    minPoolSize: 5,
  };
}

export const DEFAULT_CONNECTION_CONFIG: Omit<MongoConnectionConfig, "uri"> = {
  dbName: "GlobalBotData",
  collectionName: "sync_data",
  connectTimeoutMs: 10000,
  serverSelectionTimeoutMs: 5000,
  maxPoolSize: 20,
  minPoolSize: 5,
};

// ═══════════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ КЛИЕНТА СИНХРОНИЗАЦИИ
// ═══════════════════════════════════════════════════════════

export interface SyncClientConfig<T> {
  /** Путь в иерархии: "Staff/LowStaff/supports" */
  path: string;
  
  /** Источник данных (имя бота) */
  source: string;
  
  /** Локальная база данных */
  localDB: LocalDBAdapter<T>;
  
  /** Интервал автосинхронизации (мс), 0 = отключено */
  autoSyncInterval?: number;
  
  /** Валидатор данных */
  validator?: (data: unknown) => data is T;
  
  /** Функция восстановления данных */
  repairer?: (data: Partial<T>, key: string) => T;
}

// ═══════════════════════════════════════════════════════════
// АДАПТЕР ЛОКАЛЬНОЙ БД
// ═══════════════════════════════════════════════════════════

export interface LocalDBAdapter<T> {
  getAll(): Record<string, T>;
  get(id: string): T | null;
  set(id: string, data: T): void;
  exists(id: string): boolean;
  delete(id: string): boolean;
  update?(id: string, data: Partial<T>): T | null;
  create?(id: string, ...args: any[]): T;
}

// ═══════════════════════════════════════════════════════════
// ДОКУМЕНТ В MONGODB
// ═══════════════════════════════════════════════════════════

export interface SyncDocument<T = unknown> {
  /** Уникальный ID: "{path}:{key}" */
  _id: string;
  
  /** Путь в иерархии */
  path: string;
  
  /** Разбитый путь для индексации */
  pathParts: string[];
  
  /** Ключ записи (userId, guildId и т.д.) */
  key: string;
  
  /** Данные */
  value: T;
  
  /** Метаданные синхронизации */
  meta: SyncMeta;
}

export interface SyncMeta {
  syncedAt: Date;
  source: string;
  version: number;
  updatedAt: Date;
  createdAt: Date;
  checksum?: string;
}

// ═══════════════════════════════════════════════════════════
// ОПЕРАЦИИ СИНХРОНИЗАЦИИ
// ═══════════════════════════════════════════════════════════

export type SyncDirection = "upload" | "download" | "both";

export interface SyncOptions {
  direction: SyncDirection;
  force?: boolean;
  dryRun?: boolean;
  keys?: string[];
}

export interface SyncResult {
  success: boolean;
  path: string;
  uploaded: number;
  downloaded: number;
  skipped: number;
  deleted: number;
  errors: SyncError[];
  timestamp: Date;
  duration: number;
}

export interface SyncError {
  key?: string;
  operation: "upload" | "download" | "delete" | "connect" | "validate";
  message: string;
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════
// СТАТУС
// ═══════════════════════════════════════════════════════════

export type ConnectionState = 
  | "disconnected" 
  | "connecting" 
  | "connected" 
  | "reconnecting" 
  | "error";

export interface ConnectionStatus {
  state: ConnectionState;
  connectedAt?: Date;
  lastError?: string;
  reconnectAttempts: number;
  latency?: number;
}

export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalUploaded: number;
  totalDownloaded: number;
  lastSyncAt?: Date;
}

export interface ClientStatus {
  path: string;
  source: string;
  connected: boolean;
  autoSync: {
    enabled: boolean;
    intervalMs: number;
    lastSync?: Date;
    nextSync?: Date;
  };
  stats: SyncStats;
  counts: {
    local: number;
    remote: number;
  };
}

// Заменить определения событий на эти:

// ═══════════════════════════════════════════════════════════
// СОБЫТИЯ (с index signature)
// ═══════════════════════════════════════════════════════════

export interface SyncClientEvents<T> {
  syncStarted: (options: SyncOptions) => void;
  syncCompleted: (result: SyncResult) => void;
  syncFailed: (error: Error) => void;
  itemSynced: (key: string, direction: "up" | "down", data: T) => void;
  itemDeleted: (key: string) => void;
  conflict: (key: string, local: T, remote: T) => void;
  error: (error: Error) => void;
  [key: string]: (...args: any[]) => void; // Index signature
}

export interface ConnectionEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number, maxAttempts: number) => void;
  reconnected: () => void;
  reconnectFailed: () => void;
  error: (error: Error) => void;
  [key: string]: (...args: any[]) => void; // Index signature
}

// ═══════════════════════════════════════════════════════════
// БЭКАПЫ
// ═══════════════════════════════════════════════════════════

export interface BackupInfo {
  id: string;
  path: string;
  timestamp: Date;
  count: number;
  source: string;
  reason?: string;
}

export interface BackupDocument<T = unknown> {
  _id: string;
  backupId: string;
  originalPath: string;
  key: string;
  value: T;
  originalMeta: SyncMeta;
  backupAt: Date;
  reason?: string;
}

export interface RestoreResult {
  success: boolean;
  restored: number;
  skipped: number;
  errors: SyncError[];
}

// ═══════════════════════════════════════════════════════════
// QUERY
// ═══════════════════════════════════════════════════════════

export interface QueryOptions {
  path?: string;
  keys?: string[];
  source?: string;
  sort?: { field: string; order: "asc" | "desc" };
  limit?: number;
  skip?: number;
}

export interface AggregateResult {
  path: string;
  count: number;
  sources: string[];
  lastUpdated: Date;
}

// ═══════════════════════════════════════════════════════════
// КОНФЛИКТЫ
// ═══════════════════════════════════════════════════════════

export type ConflictResolution = "useLocal" | "useRemote" | "merge" | "skip";

export interface ConflictInfo<T> {
  key: string;
  path: string;
  localData: T;
  remoteData: T;
  localUpdatedAt: Date;
  remoteUpdatedAt: Date;
}

export type ConflictResolver<T> = (
  conflict: ConflictInfo<T>
) => ConflictResolution | Promise<ConflictResolution>;