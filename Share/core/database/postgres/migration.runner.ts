// Share/core/database/postgres/migration.runner.ts

import fs from "fs";
import path from "path";
import { query } from "./connection.pg.js";
import { logInfo, logError, logWarn } from "../../functions/logSave.function.js";

/**
 * Запускает SQL миграции из указанной директории
 * Файлы: 001_initial.sql, 002_add_templates.sql, etc.
 */
export async function runMigrations(migrationsDir: string): Promise<void> {
    // Создаём таблицу миграций если нет
    await query(`
        CREATE TABLE IF NOT EXISTS _migrations (
            version   INTEGER PRIMARY KEY,
            name      TEXT NOT NULL,
            applied   TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Какие уже применены
    const applied = await query<{ version: number }>(
        "SELECT version FROM _migrations ORDER BY version",
    );
    const appliedVersions = new Set(applied.rows.map((r) => r.version));

    // Читаем файлы миграций
    if (!fs.existsSync(migrationsDir)) {
        logWarn("MIGRATION", `Directory not found: ${migrationsDir}`);
        return;
    }

    const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

    for (const file of files) {
        const match = file.match(/^(\d+)_(.+)\.sql$/);
        if (!match) continue;

        const version = parseInt(match[1], 10);
        const name = match[2];

        if (appliedVersions.has(version)) continue;

        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

        try {
            await query("BEGIN");
            await query(sql);
            await query(
                "INSERT INTO _migrations (version, name) VALUES ($1, $2)",
                [version, name],
            );
            await query("COMMIT");
            logInfo("MIGRATION", `✅ Applied: ${file}`);
        } catch (err) {
            await query("ROLLBACK");
            logError("MIGRATION", `❌ Failed: ${file} — ${err}`);
            throw err;
        }
    }
}