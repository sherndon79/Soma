import { createApp } from "./app.js";
import { loadCapabilityCatalog, loadProviderRegistry } from "./capabilityCatalog.js";
import { loadGrantAuthority } from "./grantAuthority.js";
import { loadHarness } from "./harness.js";
import { loadHarnessModules } from "./harnessModules.js";
import { ModelClient } from "./modelClient.js";
import { loadRuntimeProfiles } from "./runtimeProfiles.js";
import { createSensoriumRuntime } from "./sensoriumRuntime.js";

const port = Number.parseInt(process.env.SOMA_PORT ?? "8765", 10);
const harness = await loadHarness();
const capabilityCatalog = await loadCapabilityCatalog();
const providerRegistry = await loadProviderRegistry();
const {
  grantStore,
  grantRecoveryReport,
} = await loadGrantAuthority({
  grantMutationProvenancePath: process.env.SOMA_GRANT_MUTATION_PROVENANCE_PATH,
});
const moduleRegistry = await loadHarnessModules();
const runtimeProfiles = await loadRuntimeProfiles();
const modelClient = new ModelClient();
const sensoriumRuntime = await createSensoriumRuntime({ logger: console });
const app = createApp({
  harness,
  capabilityCatalog,
  providerRegistry,
  grantStore,
  grantRecoveryReport,
  moduleRegistry,
  runtimeProfiles,
  modelClient,
  sensoriumSubscriber: sensoriumRuntime.subscriber,
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
}
