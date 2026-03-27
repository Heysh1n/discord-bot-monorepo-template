import {
  type Guild,
  type GuildChannel,
  type Client,
  ChannelType,
  type VoiceBasedChannel,
  type TextBasedChannel,
} from 'discord.js';

// ─── Определение типа канала ─────────────────────────────

export function isVoiceChannel(channel: GuildChannel): boolean {
  return channel.type === ChannelType.GuildVoice;
}

export function isStageChannel(channel: GuildChannel): boolean {
  return channel.type === ChannelType.GuildStageVoice;
}

export function isTextChannel(channel: GuildChannel): boolean {
  return channel.type === ChannelType.GuildText;
}

export function isCategory(channel: GuildChannel): boolean {
  return channel.type === ChannelType.GuildCategory;
}

export function isAfkChannel(guild: Guild, channelId: string): boolean {
  return guild.afkChannelId === channelId;
}

// ─── Получение каналов по типу ───────────────────────────

export function getVoiceChannels(guild: Guild): GuildChannel[] {
  return guild.channels.cache.filter(
    ch => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice
  ).map(ch => ch as GuildChannel);
}

export function getTextChannels(guild: Guild): GuildChannel[] {
  return guild.channels.cache.filter(
    ch => ch.type === ChannelType.GuildText
  ).map(ch => ch as GuildChannel);
}

// ─── Кто сейчас в войсе ─────────────────────────────────

export interface VoiceChannelInfo {
  channelId:   string;
  channelName: string;
  memberCount: number;
  members:     { id: string; displayName: string; selfMute: boolean; selfDeaf: boolean }[];
  isAfk:       boolean;
}

export function getVoiceOverview(guild: Guild): VoiceChannelInfo[] {
  const result: VoiceChannelInfo[] = [];

  for (const [, channel] of guild.channels.cache) {
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
    const vc = channel as VoiceBasedChannel;

    result.push({
      channelId:   vc.id,
      channelName: vc.name,
      memberCount: vc.members.size,
      members: vc.members.map(m => ({
        id:          m.id,
        displayName: m.displayName,
        selfMute:    m.voice.selfMute ?? false,
        selfDeaf:    m.voice.selfDeaf ?? false,
      })),
      isAfk: guild.afkChannelId === vc.id,
    });
  }

  return result.sort((a, b) => b.memberCount - a.memberCount);
}

// ─── Детектор "приватных комнат" ──────────────────────────
// Определяет временные каналы (создаются при входе в "создать комнату")

export function isTemporaryRoom(channel: GuildChannel, creatorChannelIds: string[]): boolean {
  // Если канал в той же категории что и "создать комнату"
  // и создан недавно — скорее всего временный
  if (!channel.parentId) return false;

  for (const creatorId of creatorChannelIds) {
    const creator = channel.guild.channels.cache.get(creatorId);
    if (creator && creator.parentId === channel.parentId && channel.id !== creatorId) {
      return true;
    }
  }
  return false;
}

// ─── Форматирование времени ──────────────────────────────

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}ч`);
  if (m > 0) parts.push(`${m}м`);
  if (s > 0 || parts.length === 0) parts.push(`${s}с`);
  return parts.join(' ');
}