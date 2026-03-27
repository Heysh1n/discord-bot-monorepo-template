// Share/core/database/postgres/connection.pg.ts

import pg from "pg";
import { logInfo, logError, logWarn } from "../../functions/logSave.function.js";

const { Pool } = pg;

export interface PgConnectionConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    max?: number;           // макс. соединений в пуле
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    ssl?: boolean | object;
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
    if (!pool) {
        throw new Error("[PG] Pool not initialized. Call connectPg() first.");
    }
    return pool;
}

export async function connectPg(config: PgConnectionConfig): Promise<pg.Pool> {
    if (pool) {
        logWarn("PG", "Pool already connected, returning existing");
        return pool;
    }

    pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        max: config.max ?? 10,
        idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
        connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5_000,
        ssl: config.ssl ?? false,
    });

    // Проверяем подключение
    try {
        const client = await pool.connect();
        const result = await client.query("SELECT NOW() as time");
        client.release();
        logInfo("PG", `✅ Connected to PostgreSQL | ${result.rows[0].time}`);
    } catch (err) {
        logError("PG", `❌ Connection failed: ${err}`);
        pool = null;
        throw err;
    }

    pool.on("error", (err) => {
        logError("PG", `Pool error: ${err.message}`);
    });

    return pool;
}

export async function disconnectPg(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
        logInfo("PG", "🔌 Disconnected");
    }
}

/**
 * Выполнить запрос (shortcut)
 */
export async function query<T extends pg.QueryResultRow = any>(
    text: string,
    params?: unknown[],
): Promise<pg.QueryResult<T>> {
    return getPool().query<T>(text, params);
}

/**
 * Транзакция
 */
export async function transaction<T>(
    fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}