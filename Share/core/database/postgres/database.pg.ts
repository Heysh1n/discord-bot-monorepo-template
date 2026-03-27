// Share/core/database/postgres/database.pg.ts

import { query, transaction } from "./connection.pg.js";
import { logInfo, logError, logDebug } from "../../functions/logSave.function.js";

/**
 * Абстрактный базовый класс для PostgreSQL моделей
 * Аналог LocalDBBase, но для PG
 */
export abstract class PostgresModel<T extends Record<string, unknown>> {
    protected readonly tag: string;
    protected readonly tableName: string;
    protected readonly primaryKey: string;

    constructor(tag: string, tableName: string, primaryKey: string = "id") {
        this.tag = tag;
        this.tableName = tableName;
        this.primaryKey = primaryKey;
    }

    // ═══════════════════════════════════════════════════════
    // АБСТРАКТНЫЕ — реализуй в модели
    // ═══════════════════════════════════════════════════════

    /** Преобразовать строку из БД в типизированный объект */
    protected abstract fromRow(row: Record<string, unknown>): T;

    /** Преобразовать объект в параметры для INSERT/UPDATE */
    protected abstract toRow(data: Partial<T>): Record<string, unknown>;

    // ═══════════════════════════════════════════════════════
    // CRUD
    // ═══════════════════════════════════════════════════════

    async findById(id: string | number): Promise<T | null> {
        const result = await query(
            `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = $1`,
            [id],
        );
        return result.rows[0] ? this.fromRow(result.rows[0]) : null;
    }

    async findAll(where?: string, params?: unknown[]): Promise<T[]> {
        const sql = where
            ? `SELECT * FROM ${this.tableName} WHERE ${where}`
            : `SELECT * FROM ${this.tableName}`;
        const result = await query(sql, params);
        return result.rows.map((row) => this.fromRow(row));
    }

    async findOne(where: string, params?: unknown[]): Promise<T | null> {
        const result = await query(
            `SELECT * FROM ${this.tableName} WHERE ${where} LIMIT 1`,
            params,
        );
        return result.rows[0] ? this.fromRow(result.rows[0]) : null;
    }

    async insert(data: Partial<T>): Promise<T> {
        const row = this.toRow(data);
        const keys = Object.keys(row);
        const values = Object.values(row);
        const placeholders = keys.map((_, i) => `$${i + 1}`);

        const sql = `INSERT INTO ${this.tableName} (${keys.join(", ")}) 
                      VALUES (${placeholders.join(", ")}) 
                      RETURNING *`;

        const result = await query(sql, values);
        logDebug(this.tag, `➕ Inserted into ${this.tableName}`);
        return this.fromRow(result.rows[0]);
    }

    async update(id: string | number, data: Partial<T>): Promise<T | null> {
        const row = this.toRow(data);
        const keys = Object.keys(row);
        const values = Object.values(row);

        if (keys.length === 0) return this.findById(id);

        const setClauses = keys.map((key, i) => `${key} = $${i + 1}`);
        const sql = `UPDATE ${this.tableName} 
                      SET ${setClauses.join(", ")} 
                      WHERE ${this.primaryKey} = $${keys.length + 1} 
                      RETURNING *`;

        const result = await query(sql, [...values, id]);
        return result.rows[0] ? this.fromRow(result.rows[0]) : null;
    }

    async upsert(
        data: Partial<T>,
        conflictKey: string = this.primaryKey,
    ): Promise<T> {
        const row = this.toRow(data);
        const keys = Object.keys(row);
        const values = Object.values(row);
        const placeholders = keys.map((_, i) => `$${i + 1}`);
        const updateClauses = keys
            .filter((k) => k !== conflictKey)
            .map((key, i) => `${key} = EXCLUDED.${key}`);

        const sql = `INSERT INTO ${this.tableName} (${keys.join(", ")})
                      VALUES (${placeholders.join(", ")})
                      ON CONFLICT (${conflictKey}) 
                      DO UPDATE SET ${updateClauses.join(", ")}
                      RETURNING *`;

        const result = await query(sql, values);
        return this.fromRow(result.rows[0]);
    }

    async deleteById(id: string | number): Promise<boolean> {
        const result = await query(
            `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = $1`,
            [id],
        );
        return (result.rowCount ?? 0) > 0;
    }

    async deleteWhere(where: string, params?: unknown[]): Promise<number> {
        const result = await query(
            `DELETE FROM ${this.tableName} WHERE ${where}`,
            params,
        );
        return result.rowCount ?? 0;
    }

    async count(where?: string, params?: unknown[]): Promise<number> {
        const sql = where
            ? `SELECT COUNT(*)::int as count FROM ${this.tableName} WHERE ${where}`
            : `SELECT COUNT(*)::int as count FROM ${this.tableName}`;
        const result = await query(sql, params);
        return result.rows[0]?.count ?? 0;
    }

    async exists(where: string, params?: unknown[]): Promise<boolean> {
        const result = await query(
            `SELECT EXISTS(SELECT 1 FROM ${this.tableName} WHERE ${where})::bool as exists`,
            params,
        );
        return result.rows[0]?.exists ?? false;
    }

    /** Выполнить произвольный запрос */
    async raw<R = unknown>(sql: string, params?: unknown[]): Promise<R[]> {
        const result = await query(sql, params);
        return result.rows as R[];
    }

    /** Транзакция */
    async transaction<R>(fn: (client: any) => Promise<R>): Promise<R> {
        return transaction(fn);
    }
}