import {
  ChatInputCommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
} from "discord.js";
import { DevEmbeds } from "./dev.components";
import { logInfo } from "@share/core/functions/logSave.function";

export class DevService {
  private readonly interaction: ChatInputCommandInteraction;
  private readonly embeds: DevEmbeds;

  constructor(interaction: ChatInputCommandInteraction) {
    this.interaction = interaction;
    this.embeds = new DevEmbeds(interaction);
  }

  async execute(): Promise<void> {
    await this.interaction.deferReply({ flags: MessageFlags.Ephemeral }); 
    const section = this.interaction.options.getString("section");
    if (section) {
      await this.showSection(section);
      return;
    }
    await this.showMenu();
  }

  // ГЛАВНОЕ МЕНЮ
  private async showMenu(): Promise<void> {
    const embed = this.embeds.createMainEmbed();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("dev_select")
      .setPlaceholder("📋 Выберите раздел...")
      .addOptions(
        { label: "🖥️ Система", value: "system", emoji: "🖥️" },
        { label: "📦 Конфигурация", value: "config", emoji: "📦" },
        { label: "📊 Активность", value: "activity", emoji: "📊" },
        { label: "🗄️ База данных", value: "database", emoji: "🗄️" },
        { label: "🔐 Права доступа", value: "permissions", emoji: "🔐" },
        { label: "📝 Логи", value: "logs", emoji: "📝" },
        { label: "🌐 Discord", value: "discord", emoji: "🌐" }
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
    const reply = await this.interaction.followUp({
      embeds: [embed],
      components: [row],
    });
// TODO Проверить все коллекторы и поодключить их к тайминагам из конфига.
    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 300_000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== this.interaction.user.id) {
        await i.followUp({
          content: "❌ Это не ваше меню!",
        });
        return;
      }

      const selected = i.values[0];
      await i.deferUpdate();
      await this.showSection(selected, i);
    });

    collector.on("end", async () => {
      try {
        await this.interaction.editReply({ components: [] });
      } catch {}
    });
  }

  // ПОКАЗ РАЗДЕЛА
  private async showSection(section: string, menuInteraction?: any): Promise<void> {
    let embed;

    switch (section) {
      case "system":
        embed = this.embeds.createSystemEmbed();
        break;
      case "config":
        embed = this.embeds.createConfigEmbed();
        break;
      case "activity":
        embed = this.embeds.createActivityEmbed();
        break;
      case "database":
        embed = this.embeds.createDatabaseEmbed();
        break;
      case "permissions":
        embed = this.embeds.createPermissionsEmbed();
        break;
      case "logs":
        embed = this.embeds.createLogsEmbed();
        break;
      case "discord":
        embed = this.embeds.createDiscordEmbed();
        break;
      default:
        embed = this.embeds.createMainEmbed();
    }

    logInfo("DEV", `${this.interaction.user.tag} → ${section}`);

    if (menuInteraction) {
      await menuInteraction.editReply({ embeds: [embed] });
    } else {
      await this.interaction.followUp({ embeds: [embed]});
    }
  }
}