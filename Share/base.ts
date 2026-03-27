import {
  AutocompleteInteraction,
  Collection,
  ChatInputCommandInteraction,
  GuildAuditLogs,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  GuildMember
} from "discord.js";
import { Job } from "node-schedule";

// Твои отличные алиасы — оставляем как есть
export type UserID = string;
export type CustomId = string;
export type InviteCode = string;
export type GuildID = string;

// Интерфейс для команд (заменили CommandInteraction на более точный ChatInputCommandInteraction)
export interface SlashCommand {
  data: SlashCommandBuilder | any; 
  execute: (interaction: ChatInputCommandInteraction) => Promise<any> | void;
  autoComplete?: (interaction: AutocompleteInteraction) => Promise<any> | void;
}

// Переименовали Button в Component, так как тут и модалки, и менюшки
export interface Component {
  customId: CustomId;
  execute: (
    interaction: MessageComponentInteraction | ModalSubmitInteraction
  ) => Promise<any> | void;
}

export interface Event {
  name: string;
  once: boolean;
  execute: (...args: any[]) => Promise<any> | void;
}

export interface Intervals {
  interval?: NodeJS.Timeout;
}

export type AuditCache = GuildAuditLogs<any> | undefined;

declare module "discord.js" {
  export interface Client {
    commands: Collection<string, SlashCommand | any>;
    components: Collection<CustomId, Component | any>;
    voiceUsers: Collection<UserID, GuildMember>;
    subscribes: Collection<string, Job>;
  }
}