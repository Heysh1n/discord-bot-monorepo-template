import { Client } from "discord.js";
import { logInfo, logError, logWarn } from "@share/core/functions/logSave.function";

// ТИПЫ
type ShutdownHandler = () => void | Promise<void>;
interface RegisteredHandler {
  name: string;
  handler: ShutdownHandler;
  priority: number;
}

// SHUTDOWN SERVICE 
class ShutdownService {
  private handlers: RegisteredHandler[] = [];
  private client: Client | null = null;
  private isShuttingDown = false;
  private isInitialized = false;
  private startTime = 0;

  init(client: Client): void {
    if (this.isInitialized) {
      logWarn("SHUTDOWN", "⚠️ Уже инициализирован");
      return;
    }

    this.client = client;
    this.startTime = Date.now();
    this.setupSignalHandlers();
    this.isInitialized = true;

    logInfo("SHUTDOWN", "🛡️ Shutdown сервис инициализирован");
  }

  // ═══ РЕГИСТРАЦИЯ ═══
  register(name: string, handler: ShutdownHandler, priority: number = 10): void {
    const existingIndex = this.handlers.findIndex(h => h.name === name);

    if (existingIndex !== -1) {
      this.handlers[existingIndex] = { name, handler, priority };
    } else {
      this.handlers.push({ name, handler, priority });
    }

    this.handlers.sort((a, b) => a.priority - b.priority);
  }

  unregister(name: string): boolean {
    const index = this.handlers.findIndex(h => h.name === name);
    if (index !== -1) { this.handlers.splice(index, 1); return true; }
    return false;
  }

  // ═══ СИГНАЛЫ ═══
  private setupSignalHandlers(): void {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");

    process.once("SIGINT", () => this.shutdown("SIGINT"));
    process.once("SIGTERM", () => this.shutdown("SIGTERM"));

    process.on("uncaughtException", (error) => {
      logError("SHUTDOWN", `Uncaught: ${error.message}`);
      console.error(error.stack);
      this.shutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      logWarn("SHUTDOWN", `Unhandled: ${reason}`);
    });
  }

  // ═══ ЗАВЕРШЕНИЕ ═══
  async shutdown(signal: string = "MANUAL"): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log("");
    logInfo("SHUTDOWN", `🛑 ${signal} | Handlers: ${this.handlers.length}`);

    const results: { name: string; ok: boolean }[] = [];

    // Обработчики по приоритету
    for (const { name, handler } of this.handlers) {
      try {
        await Promise.resolve(handler());
        results.push({ name, ok: true });
      } catch (error) {
        results.push({ name, ok: false });
        logError("SHUTDOWN", `❌ ${name}: ${error}`);
      }
    }

    // Отключаем Discord
    if (this.client) {
      try {
        this.client.destroy();
        results.push({ name: "Discord", ok: true });
      } catch (error) {
        results.push({ name: "Discord", ok: false });
      }
    }

    // Итоги
    const ok = results.filter(r => r.ok).map(r => r.name);
    const fail = results.filter(r => !r.ok).map(r => r.name);

    if (fail.length === 0) {
      logInfo("SHUTDOWN", `✅ ${ok.join(", ")}`);
    } else {
      logInfo("SHUTDOWN", `✅ ${ok.join(", ")} | ❌ ${fail.join(", ")}`);
    }

    const elapsed = Date.now() - this.startTime;
    const uptime = this.formatUptime(Date.now() - this.startTime);
    logInfo("SHUTDOWN", `🏁 Uptime: ${uptime}`);

    await new Promise(r => setTimeout(r, 150));
    process.exit(0);
  }

  private formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}д ${h % 24}ч ${m % 60}м`;
    if (h > 0) return `${h}ч ${m % 60}м ${s % 60}с`;
    if (m > 0) return `${m}м ${s % 60}с`;
    return `${s}с`;
  }

  // ═══ ГЕТТЕРЫ ═══
  getHandlers(): string[] { return this.handlers.map(h => `${h.name} (${h.priority})`); }
  get handlersCount(): number { return this.handlers.length; }
  get initialized(): boolean { return this.isInitialized; }
}

// SINGLETON & EXPORTS
export const shutdownService = new ShutdownService();

export const initShutdown = (client: Client) => shutdownService.init(client);
export const registerShutdown = (name: string, handler: ShutdownHandler, priority?: number) =>
  shutdownService.register(name, handler, priority);
export const unregisterShutdown = (name: string) => shutdownService.unregister(name);
export const triggerShutdown = (signal?: string) => shutdownService.shutdown(signal);