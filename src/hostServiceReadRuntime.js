import { authorizeHostServiceRequest } from "./hostServiceAuthority.js";
import {
  HOST_SERVICE_STATUS_CAPABILITY,
  hostServiceStatusProvenancePreview,
  normalizeHostServiceStatus,
} from "./hostServiceContracts.js";
import { resolveResourceDescriptor } from "./resourceRouter.js";

export async function readHostServiceStatus({
  task,
  grant,
  inventory_id,
  service_handle,
  hostServiceAuthority,
  taskLedger,
  provider,
  now = () => Date.now(),
} = {}) {
  if (!taskLedger) {
    throw new Error("Host service read runtime requires a task usage ledger.");
  }
  const providerId = hostServiceAuthority?.inventory?.host?.provider_id ?? "";
  const domain = hostServiceAuthority?.inventory?.host?.domain ?? "";
  const authorization = authorizeHostServiceRequest({
    capability: HOST_SERVICE_STATUS_CAPABILITY,
    task,
    grant,
    inventory_id,
    provider_id: providerId,
    domain,
    now,
  });
  const descriptor = await resolveResourceDescriptor({
    domain,
    capability: HOST_SERVICE_STATUS_CAPABILITY,
    ref: {
      service_handle,
      task_id: task.task_id,
    },
    grant,
    hostServiceAuthority,
    hostServiceAuthorization: authorization,
  });
  taskLedger.recordStatusRead(task);
  const raw = provider.readStatusRaw(descriptor);
  const observation = provider.inspectForPlan(descriptor);
  const result = normalizeHostServiceStatus(raw, {
    serviceHandle: descriptor.service_handle,
    observationGeneration: observation.observation_generation,
  });
  return Object.freeze({
    descriptor,
    result,
    provenance: hostServiceStatusProvenancePreview({ descriptor, result }),
  });
}
