import { EnhancedLocalDB } from "@share/core/database/local/database.local.js";

interface StaffData {
  guildId: string;
  username: string;
  level: string;
  joinedAt: number;
  points: number;
  tags: string[];
}

class StaffDB extends EnhancedLocalDB<StaffData> {
  constructor() {
    super("STAFF_DB", { fileName: "staff.json", directory: "staff" });

    // O(1) поиск по гильду
    this.defineIndex({ name: "guild", keyFn: (d) => d.guildId });

    // O(1) поиск по уровню
    this.defineIndex({ name: "level", keyFn: (d) => d.level });

    // Multi-key индекс: один юзер → несколько тегов
    this.defineIndex({ name: "tags", keyFn: (d) => d.tags });
  }

  protected validateItem(data: unknown): data is StaffData {
    const d = data as Partial<StaffData>;
    return (
      typeof d.guildId === "string" &&
      typeof d.username === "string" &&
      typeof d.level === "string" &&
      typeof d.joinedAt === "number" &&
      typeof d.points === "number" &&
      Array.isArray(d.tags)
    );
  }

  protected repairItem(data: Partial<StaffData>, id: string): StaffData {
    return {
      guildId: data.guildId ?? "",
      username: data.username ?? "Unknown",
      level: data.level ?? "worker",
      joinedAt: data.joinedAt ?? Date.now(),
      points: data.points ?? 0,
      tags: data.tags ?? [],
    };
  }

  protected createDefault(id: string): StaffData {
    return {
      guildId: "",
      username: "Unknown",
      level: "worker",
      joinedAt: Date.now(),
      points: 0,
      tags: [],
    };
  }
}

export const staffDB = new StaffDB();

// Usage:

// // Поиск по индексу — O(1)
// const guildStaff = staffDB.findByIndex("guild", "123456789");
// const managers = staffDB.findByIndex("level", "management");
// const tagged = staffDB.findByIndex("tags", "active");

// // Подписка на изменения
// const unsub = staffDB.onChange((e) => {
//   if (e.type === "delete") {
//     console.log(`Staff ${e.id} removed`);
//   }
// });

// // Batch-операции (один flush на диск)
// staffDB.setMany([
//   { id: "111", data: { ... } },
//   { id: "222", data: { ... } },
//   { id: "333", data: { ... } },
// ]);

// staffDB.updateMany([
//   { id: "111", data: { points: 50 } },
//   { id: "222", data: { level: "management" } },
// ]);

// // TTL — временная запись (удалится через 1 час)
// staffDB.setWithTTL("temp-visitor", visitorData, 60 * 60_000);

// // Агрегация
// const byLevel = staffDB.groupBy((_, d) => d.level);
// // { worker: [...], management: [...], owner: [...] }

// const totalPoints = staffDB.sumBy((d) => d.points);
// // 12345

// const levelCounts = staffDB.countBy((_, d) => d.level);
// // { worker: 15, management: 3, owner: 1 }