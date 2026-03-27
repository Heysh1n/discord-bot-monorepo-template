import { ChatInputCommandInteraction, EmbedBuilder, GuildMember } from "discord.js";
// import {
//   getMemberAccessLevel,
//   hasMinimumLevel,
//   isStaff,
//   compareHierarchy,
//   canManage,
// } from "@share/core/decorators/permissions.decorator";
export class PingService {
  private readonly interaction: ChatInputCommandInteraction;

  constructor(interaction: ChatInputCommandInteraction) {
    this.interaction = interaction;
  }

  async sendPing() {
    await this.interaction.deferReply();
    
    const embed = new EmbedBuilder()
      .setTitle("🏓 Пинг-Понг Тест:")
      .setColor(0x2b2d31)
      .addFields(
        {
          name: "Пинг Сообщений:",
          value: `> ${this.calculateMessagePing()}ms`,
          inline: true,
        },
        {
          name: "Пинг WebSocket:",
          value: `> ${this.interaction.client.ws.ping}ms`,
          inline: true,
        },
      );
      

      
    return await this.interaction.followUp({ embeds: [embed] });
  }
  private calculateMessagePing(): number {
    return Date.now() - this.interaction.createdTimestamp;
  }
  // async checkPermissions(member: GuildMember, target: GuildMember) {
  //   // Получить уровень
  //   const level = getMemberAccessLevel(member);
  //   console.log(`Уровень: ${level}`); // "management" | "staff" | null

  //   // Проверить минимальный уровень
  //   if (hasMinimumLevel(member, "staff")) {
  //     console.log("Это персонал!");
  //   }

  //   // Проверить есть ли вообще уровень
  //   if (isStaff(member)) {
  //     console.log("Участник в иерархии!");
  //   }

  //   // Сравнить двух участников
  //   if (compareHierarchy(member, target) < 0) {
  //     console.log("member выше по иерархии чем target");
  //   }

  //   // Может ли управлять
  //   if (canManage(member, target)) {
  //     console.log("member может управлять target");
  //   }
  // }

}