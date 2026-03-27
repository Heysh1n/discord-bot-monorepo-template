import { ButtonBuilder, ActionRowBuilder, GuildMember } from "discord.js";

export type ButtonCondition = boolean | ((member: GuildMember) => boolean);

export interface DynamicButton {
  id: string;
  builder: ButtonBuilder;
  condition?: ButtonCondition;
}

export function buildButtonRows(
  buttons: DynamicButton[],
  member?: GuildMember
): ActionRowBuilder<ButtonBuilder>[] {
  const visible = buttons
    .filter((btn) => {
      if (btn.condition === undefined) return true;
      if (typeof btn.condition === "boolean") return btn.condition;
      return member ? btn.condition(member) : false;
    })
    .map((btn) => btn.builder);

  if (visible.length === 0) return [];

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < visible.length; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(visible.slice(i, i + 5))
    );
  }
  return rows;
}