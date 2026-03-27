import fs from "fs";
import path from "path";
import { Client } from "discord.js";
import { logInfo, logError, logSuccess } from "@share/core/functions/logSave.function";

export default class EventCollector {
  constructor(private client: Client) {}

  /**
   * Поддерживает два паттерна:
   * - Factory:  export default new Event({ name, run(client, ...args) })
   * - Class:    export default new MyEvent()  (extends EventStructure с execute())
   */
  public async collect(): Promise<void> {
    const eventsPath = path.join(__dirname, "../client");

    if (!fs.existsSync(eventsPath)) {
      logError("EVENTS", `Папка событий не найдена: ${eventsPath}`);
      return;
    }

    const eventFiles = this.getFilesRecursively(eventsPath);
    let loadedCount = 0;
    const loadedNames: string[] = [];

    for (const file of eventFiles) {
      try {
        const module = await import(file);
        const event = module.default ?? module[Object.keys(module)[0]];

        if (!event || !event.name) {
          logError("EVENTS", `${path.basename(file)} — нет name, пропускаю`);
          continue;
        }
        const handler = typeof event.run === "function"
          ? event.run.bind(event)
          : typeof event.execute === "function"
            ? event.execute.bind(event)
            : null;

        if (!handler) {
          logError("EVENTS", `${event.name} — нет run() или execute(), пропускаю`);
          continue;
        }

        // Регистрируем
        if (event.once) {
          this.client.once(event.name, (...args: any[]) => handler(this.client, ...args));
        } else {
          this.client.on(event.name, (...args: any[]) => handler(this.client, ...args));
        }

        loadedCount++;
        loadedNames.push(event.name);
      } catch (err: any) {
        logError("EVENTS", `Ошибка загрузки ${path.basename(file)}: ${err.message}`);
        console.error(err);
      }
    }

    logSuccess("EVENTS", `Загружено: ${loadedCount} (${loadedNames.join(", ")})`);
  }

  private getFilesRecursively(dir: string): string[] {
    let results: string[] = [];

    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        results = results.concat(this.getFilesRecursively(filePath));
      } else if (file.endsWith(".event.ts") || file.endsWith(".event.js")) {
        results.push(filePath);
      }
    }

    return results;
  }
}