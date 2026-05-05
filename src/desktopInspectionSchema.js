const TOP_LEVEL_KEYS = new Set([
  "mode",
  "broker_source",
  "platform",
  "release",
  "desktop_session",
  "session_type",
  "wayland_display_present",
  "x11_display_present",
  "dbus_session_bus_available",
  "atspi_likely_available",
  "atspi_bus_address_available",
  "application_count",
  "root_object_available_count",
  "window_count",
  "candidate_adapters",
  "commands",
  "tree",
  "tree_available",
  "unavailable_reason",
  "diagnostic",
]);

const CANDIDATE_ADAPTER_KEYS = new Set([
  "atspi_dbus",
  "kde_kwin",
  "xdg_desktop_portal",
  "wayland_keyboard_input",
  "uinput_input",
]);

const COMMAND_KEYS = new Set(["gdbus", "busctl", "qdbus", "wtype", "ydotool"]);
const TREE_KEYS = new Set(["applications", "windows", "bounded", "text_content_included"]);
const APPLICATION_KEYS = new Set([
  "service",
  "pid",
  "process",
  "registry",
  "root_object",
  "root_object_error",
]);
const ROOT_OBJECT_KEYS = new Set([
  "path",
  "name",
  "role",
  "child_count",
  "children_sample",
  "child_metadata_sample",
]);
const OBJECT_REF_KEYS = new Set(["service", "path"]);
const CHILD_METADATA_KEYS = new Set(["service", "path", "role", "child_count"]);

export function validateDesktopInspectionResult(value) {
  const errors = [];
  validateTopLevel(value, errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertDesktopInspectionResult(value) {
  const result = validateDesktopInspectionResult(value);
  if (!result.valid) {
    const error = new Error(`Desktop inspection result failed schema validation: ${result.errors.join("; ")}`);
    error.code = "desktop_inspection_schema_invalid";
    error.validation_errors = result.errors;
    throw error;
  }
  return value;
}

function validateTopLevel(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("result must be an object");
    return;
  }
  rejectUnexpectedKeys(value, TOP_LEVEL_KEYS, "result", errors);
  requireStringEnum(value.mode, ["read_only_environment_probe", "read_only_atspi_probe"], "result.mode", errors);
  requireStringEnum(value.broker_source, ["rust_helper", "javascript_fallback"], "result.broker_source", errors);
  requireString(value.platform, "result.platform", errors);
  requireString(value.release, "result.release", errors);
  requireString(value.desktop_session, "result.desktop_session", errors);
  requireString(value.session_type, "result.session_type", errors);
  requireBoolean(value.dbus_session_bus_available, "result.dbus_session_bus_available", errors);
  requireBoolean(value.atspi_likely_available, "result.atspi_likely_available", errors);
  requireBoolean(value.tree_available, "result.tree_available", errors);

  optionalBoolean(value.wayland_display_present, "result.wayland_display_present", errors);
  optionalBoolean(value.x11_display_present, "result.x11_display_present", errors);
  optionalBoolean(value.atspi_bus_address_available, "result.atspi_bus_address_available", errors);
  optionalNonNegativeInteger(value.application_count, "result.application_count", errors);
  optionalNonNegativeInteger(value.root_object_available_count, "result.root_object_available_count", errors);
  optionalNonNegativeInteger(value.window_count, "result.window_count", errors);
  optionalString(value.unavailable_reason, "result.unavailable_reason", errors);
  optionalString(value.diagnostic, "result.diagnostic", errors);

  if (value.candidate_adapters !== undefined) {
    validateBooleanMap(value.candidate_adapters, CANDIDATE_ADAPTER_KEYS, "result.candidate_adapters", errors);
  }
  if (value.commands !== undefined) {
    validateBooleanMap(value.commands, COMMAND_KEYS, "result.commands", errors);
  }
  if (value.tree !== null) {
    validateTree(value.tree, errors);
  }
}

function validateTree(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("result.tree must be null or an object");
    return;
  }
  rejectUnexpectedKeys(value, TREE_KEYS, "result.tree", errors);
  if (!Array.isArray(value.applications)) {
    errors.push("result.tree.applications must be an array");
  } else {
    if (value.applications.length > 64) {
      errors.push("result.tree.applications must have at most 64 items");
    }
    value.applications.forEach((application, index) => {
      validateApplication(application, `result.tree.applications[${index}]`, errors);
    });
  }
  if (!Array.isArray(value.windows)) {
    errors.push("result.tree.windows must be an array");
  } else if (value.windows.length !== 0) {
    errors.push("result.tree.windows must be empty until desktop.inspect.windows is implemented");
  }
  if (value.bounded !== true) {
    errors.push("result.tree.bounded must be true");
  }
  if (value.text_content_included !== false) {
    errors.push("result.tree.text_content_included must be false");
  }
}

function validateApplication(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, APPLICATION_KEYS, path, errors);
  requireString(value.service, `${path}.service`, errors);
  requireNullableNonNegativeInteger(value.pid, `${path}.pid`, errors);
  requireString(value.process, `${path}.process`, errors);
  requireBoolean(value.registry, `${path}.registry`, errors);
  if (value.root_object !== null) {
    validateRootObject(value.root_object, `${path}.root_object`, errors);
  }
  requireNullableString(value.root_object_error, `${path}.root_object_error`, errors);
}

function validateRootObject(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be null or an object`);
    return;
  }
  rejectUnexpectedKeys(value, ROOT_OBJECT_KEYS, path, errors);
  if (value.path !== "/org/a11y/atspi/accessible/root") {
    errors.push(`${path}.path must be /org/a11y/atspi/accessible/root`);
  }
  requireString(value.name, `${path}.name`, errors);
  requireString(value.role, `${path}.role`, errors);
  requireNonNegativeInteger(value.child_count, `${path}.child_count`, errors);
  validateObjectRefArray(value.children_sample, 8, `${path}.children_sample`, errors);
  validateChildMetadataArray(value.child_metadata_sample, 4, `${path}.child_metadata_sample`, errors);
}

function validateObjectRefArray(value, maxItems, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > maxItems) {
    errors.push(`${path} must have at most ${maxItems} items`);
  }
  value.forEach((entry, index) => {
    validateObjectRef(entry, `${path}[${index}]`, errors);
  });
}

function validateObjectRef(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, OBJECT_REF_KEYS, path, errors);
  requireString(value.service, `${path}.service`, errors);
  requireString(value.path, `${path}.path`, errors);
}

function validateChildMetadataArray(value, maxItems, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > maxItems) {
    errors.push(`${path} must have at most ${maxItems} items`);
  }
  value.forEach((entry, index) => {
    validateChildMetadata(entry, `${path}[${index}]`, errors);
  });
}

function validateChildMetadata(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, CHILD_METADATA_KEYS, path, errors);
  requireString(value.service, `${path}.service`, errors);
  requireString(value.path, `${path}.path`, errors);
  requireString(value.role, `${path}.role`, errors);
  requireNonNegativeInteger(value.child_count, `${path}.child_count`, errors);
}

function validateBooleanMap(value, keys, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, keys, path, errors);
  for (const key of keys) {
    requireBoolean(value[key], `${path}.${key}`, errors);
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
  if (typeof value !== "string") {
    errors.push(`${path} must be a string`);
  }
}

function optionalString(value, path, errors) {
  if (value !== undefined && typeof value !== "string") {
    errors.push(`${path} must be a string`);
  }
}

function requireNullableString(value, path, errors) {
  if (value !== null && typeof value !== "string") {
    errors.push(`${path} must be null or a string`);
  }
}

function requireStringEnum(value, allowedValues, path, errors) {
  if (!allowedValues.includes(value)) {
    errors.push(`${path} must be one of ${allowedValues.join(", ")}`);
  }
}

function requireBoolean(value, path, errors) {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
  }
}

function optionalBoolean(value, path, errors) {
  if (value !== undefined && typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
  }
}

function requireNonNegativeInteger(value, path, errors) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${path} must be a non-negative integer`);
  }
}

function optionalNonNegativeInteger(value, path, errors) {
  if (value !== undefined) {
    requireNonNegativeInteger(value, path, errors);
  }
}

function requireNullableNonNegativeInteger(value, path, errors) {
  if (value !== null) {
    requireNonNegativeInteger(value, path, errors);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
