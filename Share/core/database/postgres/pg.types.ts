// Share/core/database/postgres/pg.types.ts

export interface PgModelMeta {
    tableName: string;
    primaryKey: string;
    tag: string;
}

export interface PgMigration {
    version: number;
    name: string;
    sql: string;
}

export interface PgQueryOptions {
    orderBy?: string;
    limit?: number;
    offset?: number;
}