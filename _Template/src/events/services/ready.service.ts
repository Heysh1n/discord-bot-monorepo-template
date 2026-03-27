import { Client, Guild, REST, Routes, ActivityType } from "discord.js";
import {
  logInfo, logError, logSuccess, logWarn,
} from "@share/core/functions/logSave.function";
import {
  setErrorHandlerClient
} from "@share/core/functions/antiError.function";
import {
  initPermissions,
  setLevelLabels,
} from "@share/core/decorators/permissions.decorator";
import { ActivityManager } from "@share/modules/activity/activity.manager";
import { LocalDBRegistry } from "@share/core/database/local/database.local.js";
import {token} from "../../index";
import { 
  StatusData, 
  getAccessLevels, 
  getHierarchyOrder,
  getErrorChannelId,
  logsSettings,
  ErrorHandlerCfg,
} from "../../config/config";

import InteractionCollector from "../collectors/interaction.collector";
import { getBotPaths } from "@share/constants";

export class EventReadyService {
  private readonly interactionCollector: InteractionCollector;

  constructor(private client: Client) {
    this.interactionCollector = new InteractionCollector(client);
  }

  // ERROR HANDLER
  public setupErrorHandler(): void {
    try {
      if (!ErrorHandlerCfg.enabled) {
        logWarn("ANTI-ERROR", "Error handler отключён в конфиге");
        return;
      }

      setErrorHandlerClient(this.client);
      logInfo("ANTI-ERROR", "Error handler привязан к клиенту");
    } catch (error: any) {
      logError("ANTI-ERROR", `Ошибка: ${error.message}`);
    }
  }

  // СИСТЕМА ПРАВ
  public setupPermissions(): void {
    try {
      initPermissions({
        getAccessLevels,
        getHierarchyOrder,
      });

      setLevelLabels({
        owner: "владельцам",
        management: "менеджерам",
        representative: "представителям",
        staff: "сотрудникам",
        workers: "работникам",
      });
      logInfo("PERMS", "Система прав инициализирована");
    } catch (error: any) {
      logError("PERMS", `Ошибка: ${error.message}`);
    }
  }

  // ACTIVITY MANAGER
  public setupActivityManager(): void {
    try {
      ActivityManager.init({
        ignoreBots: true,
        messageCooldownMs: 5000,
        minSessionSec: 60,
        countSelfDeaf: false,
        ignoreAfkChannel: true,
        ignoredChannels: [],
        dataDir: getBotPaths().activity,
        saveIntervalMs: 60000,
      });

      ActivityManager.getInstance().start();
    } catch (error: any) {
      logWarn("ACTIVITY", `Не удалось запустить: ${error.message}`);
    }
  }

  // РЕГИСТРАЦИЯ КОМАНД
  public async registerCommands(): Promise<void> {
    try {
      await this.interactionCollector.collect();

      const commands = this.client.commands.map((cmd: any) => cmd.data.toJSON());

      if (commands.length === 0) {
        logWarn("CMD", "Нет команд для регистрации");
        return;
      }

      const rest = new REST().setToken(token);

      const result: any = await rest.put(
        Routes.applicationCommands(this.client.user?.id || ""),
        { body: commands }
      );

      logSuccess("CMD", `Зарегистрировано: ${result.length} команд`);
    } catch (error: any) {
      logError("CMD", `Ошибка: ${error.message}`);
    }
  }
  
  // СТАТУС БОТА
  public setBotStatus(): void {
    try {
      if (StatusData.typeActivity !== undefined) {
        this.client.user?.setPresence({
          activities: [{
            name: StatusData.textActivity,
            type: StatusData.typeActivity as unknown as Exclude<ActivityType, ActivityType.Custom>,
          }],
          status: StatusData.typeStatus,
        });
        logInfo("STATUS", StatusData.textActivity);
      }
    } catch (error: any) {
      logError("STATUS", error.message);
    }
  }

  // СБОР ПОЛЬЗОВАТЕЛЕЙ
  public async allGuilds(): Promise<void> {
    let totalUsers = 0;

    for (const [, guild] of this.client.guilds.cache) {
      totalUsers += await this.collectGuildUsers(guild);
    }
    logInfo("GUILDS", `Собрано: ${totalUsers} пользователей`);
  }


  private async collectGuildUsers(guild: Guild): Promise<number> {
    try {
      const members = await guild.members.fetch();
      members.forEach((member) => {
        this.client.voiceUsers?.set(member.id, member as any);
      });
      return members.size;
    } catch (error: any) {
      logError("GUILDS", `${guild.name}: ${error.message}`);
      return 0;
    }
  }
}