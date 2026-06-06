import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_SYNTHETIC_DESKTOP_FIXTURE_ID = "testing-desktop-basic-a11y-v1";

const SYNTHETIC_DESKTOP_FIXTURES = Object.freeze({
  [DEFAULT_SYNTHETIC_DESKTOP_FIXTURE_ID]: {
    id: DEFAULT_SYNTHETIC_DESKTOP_FIXTURE_ID,
    path: fileURLToPath(new URL("../docs/fixtures/desktop/synthetic-accessibility-tree-basic.json", import.meta.url)),
  },
});

export function syntheticDesktopFixtureIds() {
  return Object.keys(SYNTHETIC_DESKTOP_FIXTURES);
}

export function syntheticDesktopFixtureDescriptor(fixtureId = "") {
  const id = String(fixtureId ?? "").trim();
  return SYNTHETIC_DESKTOP_FIXTURES[id] ?? null;
}

export async function syntheticDesktopFixtureDigest(fixtureId = "") {
  const descriptor = syntheticDesktopFixtureDescriptor(fixtureId);
  if (!descriptor) {
    throw syntheticDesktopFixtureError("synthetic_desktop_fixture_unknown", "Synthetic desktop fixture is not allowlisted.");
  }
  const bytes = await readFile(descriptor.path);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function loadSyntheticDesktopFixture(fixtureId = "") {
  const descriptor = syntheticDesktopFixtureDescriptor(fixtureId);
  if (!descriptor) {
    throw syntheticDesktopFixtureError("synthetic_desktop_fixture_unknown", "Synthetic desktop fixture is not allowlisted.");
  }
  const raw = await readFile(descriptor.path, "utf8");
  return JSON.parse(raw);
}

function syntheticDesktopFixtureError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 403;
  return error;
}
