// _Template/src/interactions/dev/dev.command.ts

import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  type SlashCommandOptionsOnlyBuilder 
} from "discord.js";
import { UseGuard } from "@share/core/decorators/permissions.decorator";
import { DevService } from "./dev.service";

export default class DevCommand {
  public data: SlashCommandOptionsOnlyBuilder;

  constructor() {
    this.data = new SlashCommandBuilder()
      .setName("dev")
      .setDescription("📊 Техническая информация о боте (только для разработчиков)")
      .addStringOption((option) =>
        option
          .setName("section")
          .setDescription("Выберите раздел")
          .setRequired(false)
          .addChoices(
            { name: "🖥️ Система", value: "system" },
            { name: "📦 Конфигурация", value: "config" },
            { name: "📊 Активность", value: "activity" },
            { name: "🗄️ База данных", value: "database" },
            { name: "🔐 Права доступа", value: "permissions" },
            { name: "📝 Логи", value: "logs" },
            { name: "🌐 Discord", value: "discord" }
          )
      );
  }

  @UseGuard("owner")
  async execute(interaction: ChatInputCommandInteraction) {
    const service = new DevService(interaction);
    return await service.execute();
  }
}