import { createApp } from "./app.js";
import { loadCapabilityCatalog, loadProviderRegistry } from "./capabilityCatalog.js";
import { loadGrantAuthority } from "./grantAuthority.js";
import { loadDurableMemoryAuthority } from "./durableMemoryAuthority.js";
import { loadDurableTestimonyAuthority } from "./durableTestimonyAuthority.js";
import { loadHarness } from "./harness.js";
import { loadHarnessModules } from "./harnessModules.js";
import { ModelClient } from "./modelClient.js";
import { loadRuntimeProfiles } from "./runtimeProfiles.js";
import { runtimeWritePostureFromEnv } from "./runtimeWritePosture.js";
import { createRemoteGraphicalRuntime } from "./remoteGraphicalRuntime.js";
import { createSensoriumRuntime } from "./sensoriumRuntime.js";

const port = Number.parseInt(process.env.SOMA_PORT ?? "8765", 10);
const harness = await loadHarness();
const capabilityCatalog = await loadCapabilityCatalog();
const providerRegistry = await loadProviderRegistry();
const {
  grantStore,
  grantRecoveryReport,
  grantStorePath,
  grantMutationProvenancePath,
} = await loadGrantAuthority({
  grantMutationProvenancePath: process.env.SOMA_GRANT_MUTATION_PROVENANCE_PATH,
});
const {
  durableMemoryStore,
  durableMemoryRecoveryReport,
  durableMemoryStorePath,
  durableMemoryProvenancePath,
} = await loadDurableMemoryAuthority({
  durableMemoryStorePath: process.env.SOMA_DURABLE_MEMORY_STORE_PATH,
  durableMemoryProvenancePath: process.env.SOMA_DURABLE_MEMORY_PROVENANCE_PATH,
});
const {
  durableTestimonyStore,
  durableTestimonyRecoveryReport,
  durableTestimonyStorePath,
  durableTestimonyProvenancePath,
} = await loadDurableTestimonyAuthority({
  durableTestimonyStorePath: process.env.SOMA_DURABLE_TESTIMONY_STORE_PATH,
  durableTestimonyProvenancePath: process.env.SOMA_DURABLE_TESTIMONY_PROVENANCE_PATH,
});
if (grantRecoveryReport?.degraded === true) {
  console.warn(
    `Soma grant authority degraded: ${
      grantRecoveryReport.grant_store_degraded_reason ?? "grant_recovery_degraded"
    }; durable authority is disabled until recovery.`,
  );
}
if (durableMemoryRecoveryReport?.degraded === true) {
  console.warn(
    `Soma durable memory degraded: ${
      durableMemoryRecoveryReport.memory_store_degraded_reason ?? "memory_durable_recovery_degraded"
    }; durable memory writes are disabled until recovery.`,
  );
}
if (durableTestimonyRecoveryReport?.degraded === true) {
  console.warn(
    `Soma durable testimony degraded: ${
      durableTestimonyRecoveryReport.testimony_store_degraded_reason ?? "testimony_durable_recovery_degraded"
    }; durable testimony writes are disabled until recovery.`,
  );
}
const moduleRegistry = await loadHarnessModules();
const runtimeProfiles = await loadRuntimeProfiles();
const runtimeWritePosture = runtimeWritePostureFromEnv(process.env);
const modelClient = new ModelClient();
const sensoriumRuntime = await createSensoriumRuntime({ logger: console });
const remoteGraphicalRuntime = await createRemoteGraphicalRuntime();
const app = createApp({
  harness,
  capabilityCatalog,
  providerRegistry,
  grantStore,
  grantRecoveryReport,
  grantStorePath,
  grantMutationProvenancePath,
  durableMemoryStore,
  durableMemoryRecoveryReport,
  durableMemoryStorePath,
  durableMemoryProvenancePath,
  durableTestimonyStore,
  durableTestimonyRecoveryReport,
  durableTestimonyStorePath,
  durableTestimonyProvenancePath,
  runtimeWritePosture,
  moduleRegistry,
  runtimeProfiles,
  modelClient,
  sensoriumSubscriber: sensoriumRuntime.subscriber,
  remoteGraphicalBroker: remoteGraphicalRuntime.broker,
});

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Soma MVP service listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdown(signal).catch((error) => {
      console.error(`Soma shutdown failed after ${signal}: ${error.message}`);
      process.exitCode = 1;
    });
  });
}

async function shutdown(signal) {
  console.log(`Soma received ${signal}; shutting down.`);
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  await sensoriumRuntime.stop();
  await remoteGraphicalRuntime.stop();
}
