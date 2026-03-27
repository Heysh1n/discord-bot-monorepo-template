import { Events, type VoiceState } from 'discord.js';
import { ActivityManager } from '@share/modules/activity/activity.manager';
// BUG Нерабочий войс апдейтер - не фиксирут время
export default {
  name: Events.VoiceStateUpdate,
  once: false,

  async execute(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (!newState.guild) return;
    const member = newState.member ?? oldState.member;
    if (!member) return;
    if (member.user.bot) return;

    try {
      const manager = ActivityManager.getInstance();
      manager.handleVoiceStateUpdate(oldState, newState);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Не инициализирован')) {
        return;
      }
      console.error('[VoiceStateUpdate] Ошибка:', err);
    }
  },
};