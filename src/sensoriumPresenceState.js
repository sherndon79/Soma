import { localAudienceContext } from "./sensoriumTier.js";

export function createSensoriumPresenceState({ now = () => new Date() } = {}) {
  let current = null;

  return Object.freeze({
    updateFromSemanticEvent(event = {}) {
      const expiresAt = parseDate(event.expires_at);
      if (!expiresAt || !event.audience_context) {
        clear();
        return read();
      }
      current = Object.freeze({
        audience_context: localAudienceContext(event.audience_context),
        expires_at: expiresAt.toISOString(),
        event_id: typeof event.event_id === "string" ? event.event_id : "",
      });
      return current.audience_context;
    },
    read({ now: readNow } = {}) {
      return read(readNow);
    },
    clear,
  });

  function read(readNow = now) {
    if (!current) {
      return localAudienceContext();
    }
    const observedNow = asDate(readNow);
    const expiresAt = parseDate(current.expires_at);
    if (!expiresAt || expiresAt.getTime() <= observedNow.getTime()) {
      clear();
      return localAudienceContext();
    }
    return localAudienceContext(current.audience_context);
  }

  function clear() {
    current = null;
  }
}

function parseDate(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asDate(value) {
  const candidate = typeof value === "function" ? value() : value;
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
    return candidate;
  }
  return new Date();
}
