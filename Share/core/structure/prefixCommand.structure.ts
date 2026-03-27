// Share/core/structure/prefix.command.structure.ts

import { Message, PermissionsBitField } from "discord.js";

export interface PrefixCommandOptions {
    /** Имя команды (без префикса) */
    name: string;
    /** Алиасы */
    aliases?: string[];
    /** Описание */
    description?: string;
    /** Минимальный уровень доступа (1=basic, 2=admin, 3=owner) */
    accessLevel?: number;
    /** Использование: "!acban <user> [reason]" */
    usage?: string;
    /** Кулдаун в секундах */
    cooldown?: number;
}

export abstract class PrefixCommandStructure {
    public readonly options: Required<PrefixCommandOptions>;

    constructor(options: PrefixCommandOptions) {
        this.options = {
            name: options.name,
            aliases: options.aliases ?? [],
            description: options.description ?? "No description",
            accessLevel: options.accessLevel ?? 1,
            usage: options.usage ?? `!${options.name}`,
            cooldown: options.cooldown ?? 3,
        };
    }

    /**
     * Выполнить команду
     * @param message — Discord Message
     * @param args — аргументы после имени команды
     */
    abstract execute(message: Message, args: string[]): Promise<void>;

    /**
     * Проверка доступа (переопределяемая)
     * По умолчанию проверяет access_users в БД
     */
    async checkAccess(message: Message): Promise<boolean> {
        // Базовая реализация — переопределяется в AntiNuke
        return true;
    }
}