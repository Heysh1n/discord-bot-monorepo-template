import { Events, Interaction } from "discord.js";
import { Event } from "@share/core/structure/event.structure";
import { logError } from "@share/core/functions/logSave.function";

export default Event({
  name: Events.InteractionCreate,

  async run(client, interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error: any) {
        console.error(error);
        logError("CMD", `Ошибка ${interaction.commandName}: ${error.message}`);

        const reply = { content: "❌ Ошибка при выполнении команды.", ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
      const customId = interaction.customId;

      let component = client.components.get(customId);
      if (!component) {
        component = client.components.find((c: any) => customId.startsWith(c.customId));
      }

      if (!component) return;

      try {
        await component.execute(interaction);
      } catch (error: any) {
        console.error(error);
        logError("COMPONENT", `Ошибка ${customId}: ${error.message}`);
      }
      return;
    }
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autoComplete) {
        try {
          await command.autoComplete(interaction);
        } catch { }
      }
    }
  },
});