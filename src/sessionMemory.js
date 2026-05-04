import { randomUUID } from "node:crypto";

export class SessionMemory {
  constructor({ maxEntries = 100 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  list() {
    return [...this.entries];
  }

  add({ role, content, source = "manual" }) {
    const entry = {
      id: randomUUID(),
      role,
      content,
      source,
      created_at: new Date().toISOString(),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return entry;
  }

  clear() {
    const removed = this.entries.length;
    this.entries = [];
    return removed;
  }

  asContext() {
    if (this.entries.length === 0) {
      return "";
    }
    return this.entries.map((entry) => `- ${entry.role}: ${entry.content}`).join("\n");
  }
}
