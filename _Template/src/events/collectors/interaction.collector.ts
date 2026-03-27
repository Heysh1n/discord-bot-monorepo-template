import { Client } from "discord.js";
import path from "path";
import fs from "fs";
import {
  logError,
  logInfo,
  logSuccess,
  isCategoryEnabled,
} from "@share/core/functions/logSave.function";

export default class InteractionCollector {
  private isCollected = false;

  constructor(private client: Client) {}

  public async collect(): Promise<void> {
    if (this.isCollected) return;
    this.isCollected = true;

    const interactionsPath = path.join(__dirname, "../../interactions");

    if (!fs.existsSync(interactionsPath)) {
      logError("INTERACTIONS", `Папка не найдена: ${interactionsPath}`);
      return;
    }

    const files = this.getFilesRecursively(interactionsPath);
    let commandsCount = 0;
    let componentsCount = 0;

    for (const file of files) {
      try {
        const module = await import(file);
        const Exported = module.default ?? module[Object.keys(module)[0]];

        const instance = typeof Exported === "function" ? new Exported() : Exported;

        if (instance?.data?.name && typeof instance.execute === "function") {
          const name = instance.data.name;
          this.client.commands.set(name, instance);
          commandsCount++;

          if (isCategoryEnabled("COMMAND_LOAD")) {
            logInfo("CMD_LOAD", `Команда: ${name}`);
          }
        }

        else if (instance?.customId && typeof instance.execute === "function") {
          this.client.components.set(instance.customId, instance);
          componentsCount++;
        }

      } catch (err: any) {
        logError("INTERACTIONS", `Ошибка загрузки ${path.basename(file)}: ${err.message}`);
      }
    }

    logSuccess("INTERACTIONS", `Команд: ${commandsCount}, Компонентов: ${componentsCount}`);
  }

  private getFilesRecursively(dir: string): string[] {
    let results: string[] = [];

    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        results = results.concat(this.getFilesRecursively(filePath));
      } else if (
        file.endsWith(".command.ts") || file.endsWith(".components.ts") ||
        file.endsWith(".command.js") || file.endsWith(".components.js")
      ) {
        results.push(filePath);
      }
    }

    return results;
  }
}