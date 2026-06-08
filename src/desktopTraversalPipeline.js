import { randomUUID } from "node:crypto";

import {
  attachTraversalToDesktopInspectionResult,
  inspectDesktopTraversalWithRustHelper,
} from "./desktopBroker.js";
import { validateDesktopTraversalRequest } from "./desktopTraversalRequest.js";
import { createValidatedTraversalProvenanceSummary } from "./desktopTraversalProvenance.js";

const CAPABILITY = "desktop.inspect.accessibility_tree";

export async function runInternalDesktopTraversalRequest({
  body,
  traversalRequest,
  inspection,
  desktopDisclosureRegistry,
  provenanceLog,
  caller = "",
  helperPath,
  inspectTraversal = inspectDesktopTraversalWithRustHelper,
} = {}) {
  const request = traversalRequest ?? validateDesktopTraversalRequest(body, {
    authorizeRootRef: (args) => desktopDisclosureRegistry?.authorizeRootRef(args),
    capability: CAPABILITY,
  });
  if (!inspectionContainsAuthorizedRoot(inspection, request.traversal.authorized_root)) {
    const error = new Error("Traversal root is not present in the current desktop inspection.");
    error.code = "desktop_traversal_root_not_in_inspection";
    error.statusCode = 403;
    throw error;
  }
  const traversal = await inspectTraversal({
    helperPath,
    authorizedRoot: request.traversal.authorized_root,
    maxDepth: request.traversal.max_depth,
    maxNodes: request.traversal.max_nodes,
    maxChildrenPerNode: request.traversal.max_children_per_node,
  });
  const inspectionWithTraversal = attachTraversalToDesktopInspectionResult({ inspection, traversal });
  const traversalSummary = createValidatedTraversalProvenanceSummary({
    rootAuthorization: request.traversal.authorized_root,
    request: request.traversal,
    traversal,
  });
  const provenance = provenanceLog?.append(createInternalDesktopTraversalEvent({
    inspection: inspectionWithTraversal,
    traversalSummary,
    caller,
  })) ?? null;

  return {
    inspection: inspectionWithTraversal,
    traversal,
    traversal_summary: traversalSummary,
    provenance,
  };
}

function inspectionContainsAuthorizedRoot(inspection, authorizedRoot) {
  if (
    typeof authorizedRoot?.service !== "string" ||
    typeof authorizedRoot?.path !== "string" ||
    !Array.isArray(inspection?.tree?.applications)
  ) {
    return false;
  }
  return inspection.tree.applications.some((application) => (
    application?.service === authorizedRoot.service &&
    application?.root_object?.path === authorizedRoot.path
  ));
}

function createInternalDesktopTraversalEvent({ inspection, traversalSummary, caller }) {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: "desktop.inspect.accessibility_tree",
    capability: CAPABILITY,
    caller_identity: caller,
    allowed: true,
    desktop_session: inspection.desktop_session,
    session_type: inspection.session_type,
    broker_source: inspection.broker_source,
    inspection_mode: inspection.mode,
    dbus_session_bus_available: inspection.dbus_session_bus_available,
    atspi_likely_available: inspection.atspi_likely_available,
    application_count: inspection.application_count ?? null,
    root_object_available_count: inspection.root_object_available_count ?? null,
    window_count: inspection.window_count ?? null,
    tree_available: inspection.tree_available,
    ...traversalSummary,
    memory_written: false,
    remote_service_used: false,
  };
}
