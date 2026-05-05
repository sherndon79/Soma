import { createApp } from "./app.js";
import { loadCapabilityCatalog, loadProviderRegistry } from "./capabilityCatalog.js";
import { loadHarness } from "./harness.js";
import { loadHarnessModules } from "./harnessModules.js";
import { ModelClient } from "./modelClient.js";
import { loadRuntimeProfiles } from "./runtimeProfiles.js";

const port = Number.parseInt(process.env.SOMA_PORT ?? "8765", 10);
const harness = await loadHarness();
const capabilityCatalog = await loadCapabilityCatalog();
const providerRegistry = await loadProviderRegistry();
const moduleRegistry = await loadHarnessModules();
const runtimeProfiles = await loadRuntimeProfiles();
const modelClient = new ModelClient();
const app = createApp({
  harness,
  capabilityCatalog,
  providerRegistry,
  moduleRegistry,
  runtimeProfiles,
  modelClient,
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Soma MVP service listening on http://127.0.0.1:${port}`);
});
