const TRAVERSAL_KEYS = new Set([
  "enabled",
  "root_ref",
  "max_depth",
  "max_nodes",
  "max_children_per_node",
]);
const REQUEST_KEYS = new Set(["mode", "traversal"]);

const DEFAULT_LIMITS = {
  max_depth: 2,
  max_nodes: 64,
  max_children_per_node: 8,
};

const LIMIT_RANGES = {
  max_depth: [1, 4],
  max_nodes: [1, 256],
  max_children_per_node: [1, 32],
};

export function validateFutureDesktopTraversalRequest(body, {
  authorizeRootRef,
  capability = "desktop.inspect.accessibility_tree",
} = {}) {
  const errors = [];

  if (!isPlainObject(body)) {
    errors.push("request must be an object");
  } else {
    for (const key of Object.keys(body)) {
      if (!REQUEST_KEYS.has(key)) {
        errors.push(`request.${key} is not allowed`);
      }
    }
    if (body.mode !== "atspi") {
      errors.push("request.mode must be atspi when traversal is enabled");
    }
    validateTraversalObject(body.traversal, errors);
  }

  if (errors.length > 0) {
    throwTraversalRequestError(errors);
  }

  const traversal = body.traversal;
  const rootAuthorization = authorizeRootRef?.({
    rootRef: traversal.root_ref,
    capability,
  }) ?? { ok: false, error: "desktop_traversal_root_not_disclosed" };

  if (!rootAuthorization.ok) {
    const error = new Error(`Desktop traversal root is invalid: ${rootAuthorization.error}`);
    error.statusCode = 403;
    error.code = rootAuthorization.error;
    throw error;
  }

  return {
    mode: "atspi",
    traversal: {
      enabled: true,
      root_ref: traversal.root_ref,
      authorized_root: rootAuthorization,
      max_depth: traversal.max_depth ?? DEFAULT_LIMITS.max_depth,
      max_nodes: traversal.max_nodes ?? DEFAULT_LIMITS.max_nodes,
      max_children_per_node: traversal.max_children_per_node ?? DEFAULT_LIMITS.max_children_per_node,
    },
  };
}

function validateTraversalObject(traversal, errors) {
  if (!isPlainObject(traversal)) {
    errors.push("request.traversal must be an object");
    return;
  }
  for (const key of Object.keys(traversal)) {
    if (!TRAVERSAL_KEYS.has(key)) {
      errors.push(`request.traversal.${key} is not allowed`);
    }
  }
  if (traversal.enabled !== true) {
    errors.push("request.traversal.enabled must be true");
  }
  if (typeof traversal.root_ref !== "string" || traversal.root_ref.length === 0) {
    errors.push("request.traversal.root_ref must be a non-empty string");
  }
  for (const [key, [minimum, maximum]] of Object.entries(LIMIT_RANGES)) {
    validateOptionalIntegerLimit(traversal[key], `request.traversal.${key}`, minimum, maximum, errors);
  }
}

function validateOptionalIntegerLimit(value, path, minimum, maximum, errors) {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${path} must be an integer from ${minimum} to ${maximum}`);
  }
}

function throwTraversalRequestError(errors) {
  const error = new Error(`Desktop traversal request is invalid: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = "desktop_traversal_request_invalid";
  error.validation_errors = errors;
  throw error;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
