import { readFile } from "node:fs/promises";

const DEFAULT_HARNESS_PATH = new URL("../config/base-harness.json", import.meta.url);

export async function loadHarness(path = DEFAULT_HARNESS_PATH) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

export function findCapability(harness, key) {
  return harness.capabilities?.find((capability) => capability.key === key) ?? null;
}

export function isCapabilityAllowed(harness, key) {
  return findCapability(harness, key)?.status === "allowed";
}

export function requireCapability(harness, key) {
  if (!isCapabilityAllowed(harness, key)) {
    const error = new Error(`Capability ${key} is not allowed by the active harness.`);
    error.statusCode = 403;
    error.code = "capability_not_allowed";
    throw error;
  }
}
