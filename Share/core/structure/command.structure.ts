import { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";

export abstract class SlashCommandStructure {
  public data: Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup"> | SlashCommandBuilder;
  
  constructor(data: Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup"> | SlashCommandBuilder) {
    this.data = data;
  }

  abstract execute(interaction: ChatInputCommandInteraction): Promise<any>;
  
  async autoComplete?(interaction: AutocompleteInteraction): Promise<any> {
    return Promise.resolve();
  }
}