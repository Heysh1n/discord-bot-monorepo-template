import { ButtonInteraction, AnySelectMenuInteraction, ModalSubmitInteraction } from "discord.js";

export abstract class ComponentStructure {
  public customId: string;

  constructor(customId: string) {
    this.customId = customId;
  }

  abstract execute(interaction: ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction): Promise<any>;
}