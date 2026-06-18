import { HOST_SERVICE_OPERATIONAL_PROVIDER_ID, hostServiceError } from "./hostServiceContracts.js";

export function createDisabledOperationalHostServiceProvider({ transport = null } = {}) {
  return Object.freeze({
    provider_id: HOST_SERVICE_OPERATIONAL_PROVIDER_ID,
    activation_status: "disabled",
    readStatusRaw() {
      refuse();
    },
    inspectForPlan() {
      refuse();
    },
    restart() {
      refuse();
    },
    transport_configured: transport !== null,
  });
}

function refuse() {
  throw hostServiceError(
    "service_status_unavailable",
    "Operational systemd provider is registered behind a disabled refusal boundary.",
    403,
  );
}
