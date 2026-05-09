const TRAVERSAL_KEYS = new Set([
  "root",
  "nodes",
  "limits",
  "truncated",
  "text_content_included",
  "withheld_fields",
]);
const ROOT_KEYS = new Set(["service", "path"]);
const NODE_KEYS = new Set(["id", "service", "path", "role", "child_count", "depth", "children"]);
const LIMIT_KEYS = new Set(["max_depth", "max_nodes", "max_children_per_node"]);
const REQUIRED_WITHHELD_FIELDS = ["name", "description", "text", "states", "actions"];

export function validateFutureDesktopTraversalOutput(value) {
  const errors = [];
  validateTraversal(value, "traversal", errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateTraversal(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, TRAVERSAL_KEYS, path, errors);
  validateObjectRef(value.root, `${path}.root`, errors);
  validateTraversalLimits(value.limits, `${path}.limits`, errors);
  validateTraversalNodes(value.nodes, value.limits, `${path}.nodes`, errors);
  if (typeof value.truncated !== "boolean") {
    errors.push(`${path}.truncated must be boolean`);
  }
  if (value.text_content_included !== false) {
    errors.push(`${path}.text_content_included must be false`);
  }
  validateWithheldFields(value.withheld_fields, `${path}.withheld_fields`, errors);
}

function validateObjectRef(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, ROOT_KEYS, path, errors);
  requireString(value.service, `${path}.service`, errors);
  requireString(value.path, `${path}.path`, errors);
}

function validateTraversalLimits(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, LIMIT_KEYS, path, errors);
  requirePositiveInteger(value.max_depth, `${path}.max_depth`, errors);
  requirePositiveInteger(value.max_nodes, `${path}.max_nodes`, errors);
  requirePositiveInteger(value.max_children_per_node, `${path}.max_children_per_node`, errors);
}

function validateTraversalNodes(value, limits, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (Number.isInteger(limits?.max_nodes) && value.length > limits.max_nodes) {
    errors.push(`${path} must have at most limits.max_nodes items`);
  }

  const ids = new Set();
  for (const [index, node] of value.entries()) {
    const nodePath = `${path}[${index}]`;
    if (!isPlainObject(node)) {
      errors.push(`${nodePath} must be an object`);
      continue;
    }
    rejectUnexpectedKeys(node, NODE_KEYS, nodePath, errors);
    requireString(node.id, `${nodePath}.id`, errors);
    requireString(node.service, `${nodePath}.service`, errors);
    requireString(node.path, `${nodePath}.path`, errors);
    requireString(node.role, `${nodePath}.role`, errors);
    requireNonNegativeInteger(node.child_count, `${nodePath}.child_count`, errors);
    requireNonNegativeInteger(node.depth, `${nodePath}.depth`, errors);
    validateNodeChildren(node.children, limits, `${nodePath}.children`, errors);

    if (typeof node.id === "string") {
      if (ids.has(node.id)) {
        errors.push(`${nodePath}.id must be unique`);
      }
      ids.add(node.id);
    }
    if (Number.isInteger(limits?.max_depth) && Number.isInteger(node.depth) && node.depth > limits.max_depth) {
      errors.push(`${nodePath}.depth must be less than or equal to limits.max_depth`);
    }
  }

  for (const [index, node] of value.entries()) {
    if (!isPlainObject(node) || !Array.isArray(node.children)) {
      continue;
    }
    for (const child of node.children) {
      if (typeof child === "string" && !ids.has(child)) {
        errors.push(`${path}[${index}].children must reference included node ids`);
      }
    }
  }
}

function validateNodeChildren(value, limits, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (
    Number.isInteger(limits?.max_children_per_node) &&
    value.length > limits.max_children_per_node
  ) {
    errors.push(`${path} must have at most limits.max_children_per_node items`);
  }
  for (const [index, child] of value.entries()) {
    if (typeof child !== "string") {
      errors.push(`${path}[${index}] must be a string`);
    }
  }
}

function validateWithheldFields(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  for (const field of REQUIRED_WITHHELD_FIELDS) {
    if (!value.includes(field)) {
      errors.push(`${path} must include ${field}`);
    }
  }
}

function rejectUnexpectedKeys(value, allowedKeys, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path}.${key} is not allowed`);
    }
  }
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requirePositiveInteger(value, path, errors) {
  if (!Number.isInteger(value) || value < 1) {
    errors.push(`${path} must be a positive integer`);
  }
}

function requireNonNegativeInteger(value, path, errors) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${path} must be a non-negative integer`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

