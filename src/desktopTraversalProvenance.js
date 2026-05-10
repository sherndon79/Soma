import { validateDesktopTraversalOutput } from "./desktopTraversalOutput.js";

export function createValidatedTraversalProvenanceSummary({
  rootAuthorization,
  request,
  traversal,
  unavailableReason = "",
} = {}) {
  if (traversal !== null && traversal !== undefined) {
    const result = validateDesktopTraversalOutput(traversal);
    if (!result.valid) {
      const error = new Error(`Desktop traversal output failed provenance validation: ${result.errors.join("; ")}`);
      error.code = "desktop_traversal_provenance_output_invalid";
      error.validation_errors = result.errors;
      throw error;
    }
  }
  return createTraversalProvenanceSummary({
    rootAuthorization,
    request,
    traversal,
    unavailableReason,
  });
}

export function createValidatedFutureTraversalProvenanceSummary(args = {}) {
  return createValidatedTraversalProvenanceSummary(args);
}

export function createTraversalProvenanceSummary({
  rootAuthorization,
  request,
  traversal,
  unavailableReason = "",
} = {}) {
  const nodes = Array.isArray(traversal?.nodes) ? traversal.nodes : [];
  return {
    traversal_requested: true,
    traversal_root_authorization: rootAuthorization?.authorization ?? "prior_disclosure",
    traversal_root_source_event_id: stringOrEmpty(rootAuthorization?.source_event_id),
    traversal_root_source_type: stringOrEmpty(rootAuthorization?.source_type),
    requested_traversal_max_depth: numberOrNull(request?.max_depth),
    requested_traversal_max_nodes: numberOrNull(request?.max_nodes),
    requested_traversal_max_children_per_node: numberOrNull(request?.max_children_per_node),
    traversal_node_count: nodes.length,
    traversal_max_returned_depth: maxReturnedDepth(nodes),
    traversal_truncated: Boolean(traversal?.truncated),
    traversal_unavailable_reason: stringOrEmpty(unavailableReason || traversal?.unavailable_reason),
    text_content_included: false,
  };
}

export function createFutureTraversalProvenanceSummary(args = {}) {
  return createTraversalProvenanceSummary(args);
}

function maxReturnedDepth(nodes) {
  return nodes.reduce((maxDepth, node) => {
    if (!Number.isInteger(node?.depth)) {
      return maxDepth;
    }
    return Math.max(maxDepth, node.depth);
  }, 0);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}
