// Share/core/structure/event.structure.ts
import { Client } from "discord.js";

// ═══════════════════════════════════════════════════════════
// ABSTRACT CLASS — Обратная совместимость (Support Bot и т.д.)
// ═══════════════════════════════════════════════════════════
// Использование:
//   class Ready extends EventStructure {
//     name = Events.ClientReady;
//     once = true;
//     async execute(client: Client) { ... }
//   }
// ═══════════════════════════════════════════════════════════

export abstract class EventStructure {
  public name: string;
  public once: boolean;

  constructor(name: string, once: boolean = false) {
    this.name = name;
    this.once = once;
  }

  abstract execute(client: Client, ...args: any[]): Promise<any>;
}

// ═══════════════════════════════════════════════════════════
// FACTORY FUNCTION — Новый паттерн (_Template и далее)
// ═══════════════════════════════════════════════════════════
// Использование:
//   export default new Event({
//     name: Events.ClientReady,
//     once: true,
//     async run(client) { ... }
//   });
// ═══════════════════════════════════════════════════════════

export interface EventOptions {
  name: string;
  once?: boolean;
  run(client: Client, ...args: any[]): Promise<any> | any;
}

export interface EventInstance {
  name: string;
  once: boolean;
  run(client: Client, ...args: any[]): Promise<any> | any;
}

export function Event(options: EventOptions): EventInstance {
  return {
    name: options.name,
    once: options.once ?? false,
    run: options.run,
  };
}