import { Events } from "discord.js";
import { Event } from "@share/core/structure/event.structure";
import { logSuccess } from "@share/core/functions/logSave.function";
import { EventReadyService } from "../services/ready.service";
import { initShutdown, registerShutdown } from "../services/shutdown.service";
import { shutdown as flushLogs } from "@share/core/functions/logSave.function";
import { ActivityManager } from "@share/modules/activity/activity.manager";
import { initPermissions, setLevelLabels } from "@share/core/decorators/permissions.decorator.js";
import {
  getAccessLevels,
  getHierarchyOrder,
  getSeniorLevels,
  getAllAccessGroups,
} from "../../config/config.js";

export default Event({
  name: Events.ClientReady,
  once: true,

  async run(client) {
    const ready = new EventReadyService(client);

    ready.setupErrorHandler();
    ready.setupActivityManager();

    await Promise.all([
      ready.registerCommands(),
      ready.allGuilds(),
    ]);
    initPermissions({
      getAccessLevels: () => getAccessLevels(),
      getHierarchyOrder: () => getHierarchyOrder(),
      getSeniorLevels: () => getSeniorLevels(),
      getDeveloperIds: () => {
        const devId = process.env.DEVELOPER_ID;
        return devId ? [devId] : [];
      },
      getAccessGroups: () => getAllAccessGroups(),
    });

    setLevelLabels({
      owner: "владельцам",
      management: "менеджерам",
      representative: "представителям",
      staff: "сотрудникам",
      workers: "работникам",
    });

    ready.setBotStatus();

    initShutdown(client);
    registerShutdown("Activity Manager", () => {
      try { ActivityManager.getInstance().stop(); } catch {}
    }, 1);
    registerShutdown("Flush Logs", () => flushLogs(), 2);

    logSuccess("READY", `Бот ${client.user?.tag} полностью инициализирован!`);
  },
});