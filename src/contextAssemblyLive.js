import { assembleContextBundle, SOURCE_ADAPTERS } from "./contextAssembly.js";
import { loadOccupantMemoryAuthority } from "./occupantMemoryAuthority.js";
import { createOccupantMemoryProvenanceFile } from "./occupantMemoryProvenanceFile.js";

const EMPTY_STORES = Object.freeze({
  occupant_memory: Object.freeze({ schema_version: 1, entries: [], tombstones: [] }),
  durable_provenance_activity: Object.freeze({ schema_version: 1, records: [] }),
  ephemeral_provenance_ring: Object.freeze({ schema_version: 1, entries: [] }),
});

export async function assembleContextFromLiveSources({
  recipe,
  provenanceLog = null,
  occupantMemoryStorePath,
  occupantMemoryProvenancePath,
  durableProvenancePath = occupantMemoryProvenancePath,
  replay = {},
  replayArtifacts = {},
  adapters = SOURCE_ADAPTERS,
  now = () => new Date(),
  idFactory,
} = {}) {
  const live = {
    occupant_memory: await readOccupantMemoryLiveSource({ occupantMemoryStorePath, occupantMemoryProvenancePath }),
    durable_provenance_activity: await readDurableProvenanceActivityLiveSource({ occupantMemoryProvenancePath: durableProvenancePath }),
    ephemeral_provenance_ring: readEphemeralRingLiveSource({ provenanceLog }),
  };
  const sourceStores = {};
  const sourceRecoveryReports = {};

  for (const [sourceClass, readResult] of Object.entries(live)) {
    sourceStores[sourceClass] = readResult.store;
    if (readResult.degraded) {
      sourceStores[sourceClass] = safeEmptyStore(sourceClass);
      sourceRecoveryReports[sourceClass] = { degraded: true, reason_class: readResult.reason_class };
      continue;
    }
    const preflight = preflightSourceStore({ sourceClass, store: readResult.store, adapters });
    if (preflight.degraded) {
      sourceStores[sourceClass] = safeEmptyStore(sourceClass);
      sourceRecoveryReports[sourceClass] = { degraded: true, reason_class: preflight.reason_class };
    }
  }

  return assembleContextBundle({
    recipe,
    sourceStores,
    sourceRecoveryReports,
    replay,
    replayArtifacts,
    adapters,
    now,
    idFactory,
  });
}

async function readOccupantMemoryLiveSource({ occupantMemoryStorePath, occupantMemoryProvenancePath }) {
  try {
    const authority = await loadOccupantMemoryAuthority({
      occupantMemoryStorePath,
      occupantMemoryProvenancePath,
    });
    return {
      store: authority.occupantMemoryStore,
      degraded: authority.occupantMemoryRecoveryReport?.degraded === true,
      reason_class: "source_degraded",
    };
  } catch {
    return {
      store: safeEmptyStore("occupant_memory"),
      degraded: true,
      reason_class: "source_degraded",
    };
  }
}

async function readDurableProvenanceActivityLiveSource({ occupantMemoryProvenancePath }) {
  try {
    const records = await createOccupantMemoryProvenanceFile({ path: occupantMemoryProvenancePath }).read();
    return {
      store: { schema_version: 1, records },
      degraded: false,
      reason_class: "",
    };
  } catch {
    return {
      store: safeEmptyStore("durable_provenance_activity"),
      degraded: true,
      reason_class: "source_degraded",
    };
  }
}

function readEphemeralRingLiveSource({ provenanceLog }) {
  try {
    const entries = typeof provenanceLog?.list === "function" ? provenanceLog.list() : [];
    return {
      store: { schema_version: 1, entries },
      degraded: false,
      reason_class: "",
    };
  } catch {
    return {
      store: safeEmptyStore("ephemeral_provenance_ring"),
      degraded: true,
      reason_class: "source_degraded",
    };
  }
}

function preflightSourceStore({ sourceClass, store, adapters }) {
  const adapter = adapters[sourceClass];
  if (!adapter) {
    return { degraded: false, reason_class: "" };
  }
  try {
    adapter.snapshot(store);
    return { degraded: false, reason_class: "" };
  } catch {
    return { degraded: true, reason_class: "source_degraded" };
  }
}

function safeEmptyStore(sourceClass) {
  return EMPTY_STORES[sourceClass] ?? {};
}
