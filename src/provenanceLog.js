export class ProvenanceLog {
  constructor({ maxEntries = 200 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  append(record) {
    this.entries.push(record);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return record;
  }

  list() {
    return [...this.entries];
  }

  query({ allowed = null, capability = "", eventType = "", limit = null } = {}) {
    let entries = this.list();
    if (allowed !== null) {
      entries = entries.filter((entry) => entry.allowed === allowed);
    }
    if (capability) {
      entries = entries.filter((entry) => entry.capability === capability);
    }
    if (eventType) {
      entries = entries.filter((entry) => entry.event_type === eventType);
    }
    if (limit !== null) {
      entries = entries.slice(-limit);
    }
    return entries;
  }

  summary() {
    const entries = this.list();
    return entries.reduce((summary, entry) => {
      summary.total += 1;
      if (entry.allowed === true) {
        summary.allowed += 1;
      }
      if (entry.allowed === false) {
        summary.denied += 1;
      }
      if (entry.memory_read) {
        summary.memory_read += 1;
      }
      if (entry.memory_written) {
        summary.memory_written += 1;
      }
      if (entry.remote_service_used) {
        summary.remote_service_used += 1;
      }
      if (entry.cognitive_load_assessed) {
        summary.cognitive_load_assessed += 1;
      }
      const capability = entry.capability || "unknown";
      summary.by_capability[capability] = (summary.by_capability[capability] ?? 0) + 1;
      const eventType = entry.event_type || "unknown";
      summary.by_event_type[eventType] = (summary.by_event_type[eventType] ?? 0) + 1;
      return summary;
    }, {
      total: 0,
      allowed: 0,
      denied: 0,
      memory_read: 0,
      memory_written: 0,
      remote_service_used: 0,
      cognitive_load_assessed: 0,
      by_capability: {},
      by_event_type: {},
    });
  }

  clear() {
    const removed = this.entries.length;
    this.entries = [];
    return removed;
  }
}
