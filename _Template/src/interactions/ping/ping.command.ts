import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { SlashCommandStructure } from "@share/core/structure/command.structure";
import { UseGuard } from "@share/core/decorators/permissions.decorator";
import { PingService } from "./ping.service";

export default class PingCommand extends SlashCommandStructure {
  constructor() {
    super(
      new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Игра в ping-pong!")
    );
  }

  // @UseGuard({
    //   accessLevel: "management",
    //   channels: ["1234567890"], // Только в определённом канале
    //   excludeRoles: ["987654321"], // Кроме этой роли
    // })
  @UseGuard("staff")
  async execute(interaction: ChatInputCommandInteraction) {
    const pingService = new PingService(interaction);
    return await pingService.sendPing();
  }
}