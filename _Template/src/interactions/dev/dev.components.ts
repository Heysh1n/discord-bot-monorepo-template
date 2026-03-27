import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import os from "os";
import process from "process";
import {
  configManager,
  logsSettings,
  DatabaseSettings,
  getHierarchyOrder,
  getAccessLevels,
  ErrorHandlerCfg,
} from "../../config/config";
import { getErrorHandlerStatus } from "@share/core/functions/antiError.function";
import { ActivityManager } from "@share/modules/activity/activity.manager";

export class DevEmbeds {
  private readonly interaction: ChatInputCommandInteraction;

  constructor(interaction: ChatInputCommandInteraction) {
    this.interaction = interaction;
  }

  // ГЛАВНЫЙ EMBED
  createMainEmbed(): EmbedBuilder {
    const uptime = this.formatUptime(process.uptime());
    const memUsage = this.formatBytes(process.memoryUsage().heapUsed);
    const memTotal = this.formatBytes(process.memoryUsage().heapTotal);

    return new EmbedBuilder()
      .setTitle("🛠️ Техническая информация — Dev Panel")
      .setDescription(
        "Выберите раздел из меню ниже для получения детальной информации.\n\n" +
          `**Бот:** \`${this.interaction.client.user?.tag}\`\n` +
          `**Uptime:** ${uptime}\n` +
          `**Memory:** ${memUsage} / ${memTotal}\n` +
          `**Node.js:** ${process.version}\n` +
          `**PID:** ${process.pid}`
      )
      .setColor(0x5865f2)
      .setTimestamp()
      .setFooter({
        text: `Запрошено: ${this.interaction.user.tag}`,
        iconURL: this.interaction.user.displayAvatarURL(),
      });
  }

  // 🖥️ СИСТЕМА
  createSystemEmbed(): EmbedBuilder {
    const uptime = this.formatUptime(process.uptime());
    const sysUptime = this.formatUptime(os.uptime());
    const mem = process.memoryUsage();

    return new EmbedBuilder()
      .setTitle("🖥️ Система")
      .setColor(0x57f287)
      .addFields(
        {
          name: "📊 Process",
          value: [
            `**PID:** ${process.pid}`,
            `**Uptime:** ${uptime}`,
            `**Node.js:** ${process.version}`,
            `**Platform:** ${process.platform} (${process.arch})`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "💾 Memory",
          value: [
            `**Heap Used:** ${this.formatBytes(mem.heapUsed)}`,
            `**Heap Total:** ${this.formatBytes(mem.heapTotal)}`,
            `**RSS:** ${this.formatBytes(mem.rss)}`,
            `**External:** ${this.formatBytes(mem.external)}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "🖥️ OS",
          value: [
            `**Type:** ${os.type()} ${os.release()}`,
            `**Uptime:** ${sysUptime}`,
            `**CPUs:** ${os.cpus().length}x ${os.cpus()[0]?.model || "Unknown"}`,
            `**Free RAM:** ${this.formatBytes(os.freemem())} / ${this.formatBytes(os.totalmem())}`,
          ].join("\n"),
        },
        {
          name: "🔧 Environment",
          value: [
            `**Mode:** ${logsSettings.mode}`,
            `**Timezone:** ${logsSettings.timezone}`,
            `**CWD:** \`${process.cwd()}\``,
          ].join("\n"),
        }
      )
      .setTimestamp();
  }

  // 📦 КОНФИГУРАЦИЯ
  createConfigEmbed(): EmbedBuilder {
    const status = configManager.getStatus();

    const configList = Object.entries(status.configs as Record<string, any>)
      .map(([name, info]) => {
        const icon = info.generated ? "🆕" : "✅";
        const watcher = info.hasWatcher ? "🔥" : "❄️";
        return `${icon} **${name}** ${watcher}`;
      })
      .join("\n");

    return new EmbedBuilder()
      .setTitle("📦 Конфигурация")
      .setColor(0xfee75c)
      .addFields(
        {
          name: "📋 Статус",
          value: [
            `**Dir:** \`${status.configDir}\``,
            `**Configs:** ${status.registeredConfigs}`,
            `**Hot-reload:** ${status.hotReload ? "✅" : "❌"}`,
            `**Listeners:** ${status.globalListeners}`,
          ].join("\n"),
        },
        {
          name: "📄 Файлы",
          value: configList || "Нет конфигов",
        },
        {
          name: "📖 Легенда",
          value: "🆕 — Сгенерирован\n✅ — Загружен\n🔥 — Hot-reload\n❄️ — Static",
        }
      )
      .setTimestamp();
  }

  // 📊 АКТИВНОСТЬ
  createActivityEmbed(): EmbedBuilder {
    try {
      const manager = ActivityManager.getInstance();
      const storage = manager.getStorage();
      const guildId = this.interaction.guildId!;

      const users = storage.getGuildUsers(guildId);
      const topVoice = storage.getTopVoice(guildId, 5);
      const topMessages = storage.getTopMessages(guildId, 5);

      const voiceList = topVoice
        .map((u, i) => {
          const hours = Math.floor(u.voice.totalSeconds / 3600);
          return `${i + 1}. <@${u.discordId}> — **${hours}ч**`;
        })
        .join("\n") || "Нет данных";

      const msgList = topMessages
        .map((u, i) => `${i + 1}. <@${u.discordId}> — **${u.messages.total}**`)
        .join("\n") || "Нет данных";

      return new EmbedBuilder()
        .setTitle("📊 Система активности")
        .setColor(0x5865f2)
        .addFields(
          {
            name: "📈 Общая статистика",
            value: [
              `**Записей:** ${users.length}`,
              `**Источник:** ActivityManager`,
              `**Статус:** ✅ Активен`,
            ].join("\n"),
          },
          {
            name: "🎙️ Топ по войсу",
            value: voiceList,
            inline: true,
          },
          {
            name: "💬 Топ по сообщениям",
            value: msgList,
            inline: true,
          }
        )
        .setTimestamp();
    } catch {
      return new EmbedBuilder()
        .setTitle("📊 Система активности")
        .setDescription("⚠️ ActivityManager не инициализирован")
        .setColor(0xfee75c);
    }
  }

  // 🗄️ БАЗА ДАННЫХ
  createDatabaseEmbed(): EmbedBuilder {
    const local = DatabaseSettings.local;
    const mongo = DatabaseSettings.mongo;
    const logging = DatabaseSettings.logging;

    return new EmbedBuilder()
      .setTitle("🗄️ База данных")
      .setColor(0x57f287)
      .addFields(
        {
          name: "📁 Local DB",
          value: [
            `**Status:** ${local.enabled ? "✅ Enabled" : "❌ Disabled"}`,
            `**File:** \`${local.fileName}\``,
            `**Dir:** \`${local.directory}\``,
            `**Debounce:** ${local.saveDebounceMs}ms`,
            `**Backup:** ${local.backupOnCorrupted ? "✅" : "❌"}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "🌐 MongoDB",
          value: [
            `**Status:** ${mongo.enabled ? "✅ Enabled" : "❌ Disabled"}`,
            `**Database:** \`${mongo.database}\``,
            `**Collection:** \`${mongo.collection}\``,
            `**Auto-sync:** ${mongo.autoSync.enabled ? `✅ (${mongo.autoSync.intervalMs / 1000}s)` : "❌"}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "📝 Logging",
          value: [
            `**Loads:** ${logging.logLoads ? "✅" : "❌"}`,
            `**Saves:** ${logging.logSaves ? "✅" : "❌"}`,
            `**Repairs:** ${logging.logRepairs ? "✅" : "❌"}`,
            `**Sync:** ${logging.logSync ? "✅" : "❌"}`,
          ].join("\n"),
        }
      )
      .setTimestamp();
  }

  // 🔐 ПРАВА ДОСТУПА
  // FIXME Не рабочяя оторожение Прав доступа.
  createPermissionsEmbed(): EmbedBuilder {
    const hierarchy = getHierarchyOrder();
    const levels = getAccessLevels();

    const hierarchyText = hierarchy
      .map((level, i) => {
        const roles = levels[level] || [];
        const rolesText = roles.map((id) => `<@&${id}>`).join(", ") || "Нет";
        return `**${i + 1}. ${level}**\n${rolesText}`;
      })
      .join("\n\n");

    return new EmbedBuilder()
      .setTitle("🔐 Система прав")
      .setColor(0xed4245)
      .addFields(
        {
          name: "📊 Иерархия (от высшего к низшему)",
          value: hierarchyText || "Не настроено",
        },
        {
          name: "ℹ️ Информация",
          value: [
            `**Уровней:** ${hierarchy.length}`,
            `**Resolver:** ✅ Инициализирован`,
            `**Hot-reload:** ✅ Поддерживается`,
          ].join("\n"),
        }
      )
      .setTimestamp();
  }

  // 📝 ЛОГИ
  createLogsEmbed(): EmbedBuilder {
    const errorStatus = getErrorHandlerStatus();

    const categoriesText = Object.entries(logsSettings.categories)
      .filter(([_, enabled]) => enabled)
      .map(([name]) => `\`${name}\``)
      .join(", ");

    return new EmbedBuilder()
      .setTitle("📝 Система логирования")
      .setColor(0x5865f2)
      .addFields(
        {
          name: "📁 Файлы",
          value: [
            `**Dir:** \`${logsSettings.logsDir}\``,
            `**Archive:** \`${logsSettings.archiveDir}\``,
            `**Max Size:** ${logsSettings.maxFileSizeMB}MB`,
            `**Keep:** ${logsSettings.keepArchiveDays} дней`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "⚙️ Настройки",
          value: [
            `**Min Level:** ${logsSettings.minLevel}`,
            `**Mode:** ${logsSettings.mode}`,
            `**Timezone:** ${logsSettings.timezone}`,
            `**Intercept:** ${logsSettings.interceptConsole ? "✅" : "❌"}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "🛡️ Error Handler",
          value: [
            `**Status:** ${errorStatus.initialized ? "✅" : "❌"}`,
            `**Client:** ${errorStatus.clientReady ? "✅" : "❌"}`,
            `**Queue:** ${errorStatus.queueSize}`,
            `**Crashes:** \`${ErrorHandlerCfg.crashLogsDir}\``,
          ].join("\n"),
        },
        {
          name: "📋 Активные категории",
          value: categoriesText || "Все отключены",
        }
      )
      .setTimestamp();
  }

  // 🌐 DISCORD
  createDiscordEmbed(): EmbedBuilder {
    const client = this.interaction.client;
    const guild = this.interaction.guild!;

    const commands = client.commands.size;
    const components = client.components.size;
    const guilds = client.guilds.cache.size;
    const users = client.users.cache.size;
    const channels = guild.channels.cache.size;
    const roles = guild.roles.cache.size;
    const emojis = guild.emojis.cache.size;
    const members = guild.memberCount;

    return new EmbedBuilder()
      .setTitle("🌐 Discord — Статистика")
      .setColor(0x5865f2)
      .addFields(
        {
          name: "🤖 Бот",
          value: [
            `**Tag:** ${client.user?.tag}`,
            `**ID:** ${client.user?.id}`,
            `**Ping:** ${client.ws.ping}ms`,
            `**Guilds:** ${guilds}`,
            `**Users:** ${users}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "🏰 Сервер",
          value: [
            `**Name:** ${guild.name}`,
            `**ID:** ${guild.id}`,
            `**Members:** ${members}`,
            `**Channels:** ${channels}`,
            `**Roles:** ${roles}`,
            `**Emojis:** ${emojis}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "📦 Интеракции",
          value: [
            `**Commands:** ${commands}`,
            `**Components:** ${components}`,
            `**Voice Users:** ${client.voiceUsers?.size || 0}`,
          ].join("\n"),
        }
      )
      .setThumbnail(guild.iconURL() || "")
      .setTimestamp();
  }

  // ХЕЛПЕРЫ
  private formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (d > 0) parts.push(`${d}д`);
    if (h > 0) parts.push(`${h}ч`);
    if (m > 0) parts.push(`${m}м`);
    if (s > 0 || parts.length === 0) parts.push(`${s}с`);

    return parts.join(" ");
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}