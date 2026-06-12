import { validateDesktopTraversalOutput } from "./desktopTraversalOutput.js";

const TOP_LEVEL_KEYS = new Set([
  "mode",
  "broker_source",
  "platform_family",
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
  "root_object",
  "root_object_error",
]);
const TRAVERSAL_AUTHORIZED_APPLICATION_KEYS = new Set([
  "service",
  "pid",
  "process",
  "registry",
  ...APPLICATION_KEYS,
]);
const ROOT_OBJECT_KEYS = new Set([
  "role",
  "child_count",
  "child_metadata_sample",
]);
const TRAVERSAL_AUTHORIZED_ROOT_OBJECT_KEYS = new Set([
  ...ROOT_OBJECT_KEYS,
  "path",
  "children_sample",
  "traversal",
]);
const OBJECT_REF_KEYS = new Set(["service", "path"]);
const CHILD_METADATA_KEYS = new Set(["role", "child_count"]);
const TRAVERSAL_AUTHORIZED_CHILD_METADATA_KEYS = new Set(["service", "path", ...CHILD_METADATA_KEYS]);
const WINDOWS_TOP_LEVEL_KEYS = new Set([
  "mode",
  "broker_source",
  "platform_family",
  "dbus_session_bus_available",
  "atspi_bus_address_available",
  "window_count",
  "windows",
  "bounded",
  "geometry_included",
  "focus_included",
  "identity_fields_included",
  "text_content_included",
  "titles_included",
  "withheld_fields",
  "unavailable_reason",
  "diagnostic",
  "generation_id",
]);
const WINDOW_KEYS = new Set([
  "index",
  "z_order",
  "role",
  "child_count",
  "focused",
  "geometry",
  "text_content_included",
  "titles_included",
  "act_ref",
  "act_kinds",
]);
const WINDOW_GEOMETRY_KEYS = new Set(["x", "y", "width", "height"]);
const TEXT_TOP_LEVEL_KEYS = new Set([
  "mode",
  "broker_source",
  "platform_family",
  "dbus_session_bus_available",
  "atspi_bus_address_available",
  "window_count",
  "text_item_count",
  "windows",
  "bounded",
  "truncated",
  "max_windows",
  "max_nodes_per_window",
  "max_text_items",
  "max_text_chars_per_item",
  "titles_included",
  "names_included",
  "descriptions_included",
  "text_content_included",
  "identity_fields_included",
  "screenshots_included",
  "withheld_fields",
  "unavailable_reason",
  "diagnostic",
  "generation_id",
]);
const TEXT_WINDOW_KEYS = new Set([
  "index",
  "z_order",
  "role",
  "child_count",
  "geometry",
  "title",
  "text_items",
  "truncated",
]);
const TEXT_ITEM_KEYS = new Set(["kind", "role", "text", "act_ref", "act_kinds"]);
const ACT_KINDS = new Set(["invoke_default", "text_insert", "text_set"]);
const BOUNDED_TEXT_KEYS = new Set(["value", "char_count", "truncated"]);

export function validateDesktopInspectionResult(value, options = {}) {
  const errors = [];
  validateTopLevel(value, errors, options);
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateFutureDesktopInspectionResultWithTraversal(value) {
  return validateTraversalAuthorizedDesktopInspectionResult(value);
}

export function validateTraversalAuthorizedDesktopInspectionResult(value) {
  return validateDesktopInspectionResult(value, {
    allowTraversalOutput: true,
  });
}

export function assertTraversalAuthorizedDesktopInspectionResult(value) {
  const result = validateTraversalAuthorizedDesktopInspectionResult(value);
  if (!result.valid) {
    const error = new Error(`Traversal-authorized desktop inspection result failed schema validation: ${result.errors.join("; ")}`);
    error.statusCode = 502;
    error.code = "desktop_traversal_authorized_inspection_schema_invalid";
    error.validation_errors = result.errors;
    throw error;
  }
  return value;
}

export function assertDesktopInspectionResult(value) {
  const result = validateDesktopInspectionResult(value);
  if (!result.valid) {
    const error = new Error(`Desktop inspection result failed schema validation: ${result.errors.join("; ")}`);
    error.statusCode = 502;
    error.code = "desktop_inspection_schema_invalid";
    error.validation_errors = result.errors;
    throw error;
  }
  return value;
}

export function validateDesktopWindowsInspectionResult(value) {
  const errors = [];
  validateWindowsTopLevel(value, errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertDesktopWindowsInspectionResult(value) {
  const result = validateDesktopWindowsInspectionResult(value);
  if (!result.valid) {
    const error = new Error(`Desktop windows inspection result failed schema validation: ${result.errors.join("; ")}`);
    error.statusCode = 502;
    error.code = "desktop_windows_inspection_schema_invalid";
    error.validation_errors = result.errors;
    throw error;
  }
  return value;
}

export function validateDesktopTextInspectionResult(value) {
  const errors = [];
  validateTextTopLevel(value, errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertDesktopTextInspectionResult(value) {
  const result = validateDesktopTextInspectionResult(value);
  if (!result.valid) {
    const error = new Error(`Desktop text inspection result failed schema validation: ${result.errors.join("; ")}`);
    error.statusCode = 502;
    error.code = "desktop_text_inspection_schema_invalid";
    error.validation_errors = result.errors;
    throw error;
  }
  return value;
}

function validateTopLevel(value, errors, options) {
  if (!isPlainObject(value)) {
    errors.push("result must be an object");
    return;
  }
  rejectUnexpectedKeys(value, TOP_LEVEL_KEYS, "result", errors);
  requireStringEnum(value.mode, ["read_only_environment_probe", "read_only_atspi_probe"], "result.mode", errors);
  requireStringEnum(value.broker_source, ["rust_helper", "javascript_fallback", "synthetic_fixture"], "result.broker_source", errors);
  if (value.mode === "read_only_atspi_probe" && !options.allowTraversalOutput) {
    requireString(value.platform_family, "result.platform_family", errors);
    rejectPresent(value, ["platform", "release", "desktop_session", "session_type"], "result", errors);
  } else if (value.mode === "read_only_atspi_probe") {
    if (value.platform_family === undefined) {
      requireString(value.platform, "result.platform", errors);
      requireString(value.release, "result.release", errors);
      requireString(value.desktop_session, "result.desktop_session", errors);
      requireString(value.session_type, "result.session_type", errors);
    } else {
      requireString(value.platform_family, "result.platform_family", errors);
      optionalString(value.platform, "result.platform", errors);
      optionalString(value.release, "result.release", errors);
      optionalString(value.desktop_session, "result.desktop_session", errors);
      optionalString(value.session_type, "result.session_type", errors);
    }
  } else {
    requireString(value.platform, "result.platform", errors);
    requireString(value.release, "result.release", errors);
    requireString(value.desktop_session, "result.desktop_session", errors);
    requireString(value.session_type, "result.session_type", errors);
    optionalString(value.platform_family, "result.platform_family", errors);
  }
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
    validateTree(value.tree, errors, options);
  }
}

function validateTree(value, errors, options) {
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
      validateApplication(application, `result.tree.applications[${index}]`, errors, options);
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

function validateApplication(value, path, errors, options) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const applicationKeys = options.allowTraversalOutput ? TRAVERSAL_AUTHORIZED_APPLICATION_KEYS : APPLICATION_KEYS;
  rejectUnexpectedKeys(value, applicationKeys, path, errors);
  if (options.allowTraversalOutput) {
    requireString(value.service, `${path}.service`, errors);
    requireNullableNonNegativeInteger(value.pid, `${path}.pid`, errors);
    requireString(value.process, `${path}.process`, errors);
    requireBoolean(value.registry, `${path}.registry`, errors);
  }
  if (value.root_object !== null) {
    validateRootObject(value.root_object, `${path}.root_object`, errors, options);
  }
  requireNullableString(value.root_object_error, `${path}.root_object_error`, errors);
}

function validateRootObject(value, path, errors, options) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be null or an object`);
    return;
  }
  const rootKeys = options.allowTraversalOutput ? TRAVERSAL_AUTHORIZED_ROOT_OBJECT_KEYS : ROOT_OBJECT_KEYS;
  rejectUnexpectedKeys(value, rootKeys, path, errors);
  if (options.allowTraversalOutput) {
    if (value.path !== "/org/a11y/atspi/accessible/root") {
      errors.push(`${path}.path must be /org/a11y/atspi/accessible/root`);
    }
    if (value.children_sample !== undefined) {
      validateObjectRefArray(value.children_sample, 8, `${path}.children_sample`, errors);
    }
  }
  requireString(value.role, `${path}.role`, errors);
  requireNonNegativeInteger(value.child_count, `${path}.child_count`, errors);
  validateChildMetadataArray(value.child_metadata_sample, 4, `${path}.child_metadata_sample`, errors, options);
  if (options.allowTraversalOutput && value.traversal !== undefined) {
    const traversalResult = validateDesktopTraversalOutput(value.traversal);
    for (const error of traversalResult.errors) {
      errors.push(`${path}.${error}`);
    }
  }
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

function validateChildMetadataArray(value, maxItems, path, errors, options = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > maxItems) {
    errors.push(`${path} must have at most ${maxItems} items`);
  }
  value.forEach((entry, index) => {
    validateChildMetadata(entry, `${path}[${index}]`, errors, options);
  });
}

function validateChildMetadata(value, path, errors, options = {}) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const childKeys = options.allowTraversalOutput ? TRAVERSAL_AUTHORIZED_CHILD_METADATA_KEYS : CHILD_METADATA_KEYS;
  rejectUnexpectedKeys(value, childKeys, path, errors);
  if (options.allowTraversalOutput) {
    requireString(value.service, `${path}.service`, errors);
    requireString(value.path, `${path}.path`, errors);
  }
  requireString(value.role, `${path}.role`, errors);
  requireNonNegativeInteger(value.child_count, `${path}.child_count`, errors);
}

function validateWindowsTopLevel(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("result must be an object");
    return;
  }
  rejectUnexpectedKeys(value, WINDOWS_TOP_LEVEL_KEYS, "result", errors);
  requireStringEnum(value.mode, ["read_only_window_probe"], "result.mode", errors);
  requireStringEnum(value.broker_source, ["rust_helper", "javascript_fallback"], "result.broker_source", errors);
  requireString(value.platform_family, "result.platform_family", errors);
  rejectPresent(value, ["platform", "release", "desktop_session", "session_type"], "result", errors);
  requireBoolean(value.dbus_session_bus_available, "result.dbus_session_bus_available", errors);
  optionalBoolean(value.atspi_bus_address_available, "result.atspi_bus_address_available", errors);
  requireNonNegativeInteger(value.window_count, "result.window_count", errors);
  requireBoolean(value.bounded, "result.bounded", errors);
  if (value.bounded !== true) {
    errors.push("result.bounded must be true");
  }
  if (value.geometry_included !== true) {
    errors.push("result.geometry_included must be true");
  }
  if (value.focus_included !== true) {
    errors.push("result.focus_included must be true");
  }
  if (value.identity_fields_included !== false) {
    errors.push("result.identity_fields_included must be false");
  }
  if (value.text_content_included !== false) {
    errors.push("result.text_content_included must be false");
  }
  if (value.titles_included !== false) {
    errors.push("result.titles_included must be false");
  }
  if (!Array.isArray(value.withheld_fields)) {
    errors.push("result.withheld_fields must be an array");
  }
  optionalString(value.unavailable_reason, "result.unavailable_reason", errors);
  optionalString(value.diagnostic, "result.diagnostic", errors);
  optionalNonNegativeInteger(value.generation_id, "result.generation_id", errors);
  validateWindowArray(value.windows, "result.windows", errors);
}

function validateWindowArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > 64) {
    errors.push(`${path} must have at most 64 items`);
  }
  value.forEach((window, index) => validateWindow(window, `${path}[${index}]`, errors));
}

function validateWindow(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, WINDOW_KEYS, path, errors);
  requireNonNegativeInteger(value.index, `${path}.index`, errors);
  requireNonNegativeInteger(value.z_order, `${path}.z_order`, errors);
  requireString(value.role, `${path}.role`, errors);
  requireNonNegativeInteger(value.child_count, `${path}.child_count`, errors);
  requireBoolean(value.focused, `${path}.focused`, errors);
  if (value.geometry !== null) {
    validateWindowGeometry(value.geometry, `${path}.geometry`, errors);
  }
  if (value.text_content_included !== false) {
    errors.push(`${path}.text_content_included must be false`);
  }
  if (value.titles_included !== false) {
    errors.push(`${path}.titles_included must be false`);
  }
  optionalString(value.act_ref, `${path}.act_ref`, errors);
  optionalStringEnumArray(value.act_kinds, ACT_KINDS, `${path}.act_kinds`, errors);
}

function validateWindowGeometry(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be null or an object`);
    return;
  }
  rejectUnexpectedKeys(value, WINDOW_GEOMETRY_KEYS, path, errors);
  requireInteger(value.x, `${path}.x`, errors);
  requireInteger(value.y, `${path}.y`, errors);
  requireNonNegativeInteger(value.width, `${path}.width`, errors);
  requireNonNegativeInteger(value.height, `${path}.height`, errors);
}

function validateTextTopLevel(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("result must be an object");
    return;
  }
  rejectUnexpectedKeys(value, TEXT_TOP_LEVEL_KEYS, "result", errors);
  requireStringEnum(value.mode, ["read_only_desktop_text_probe"], "result.mode", errors);
  requireStringEnum(value.broker_source, ["rust_helper"], "result.broker_source", errors);
  requireString(value.platform_family, "result.platform_family", errors);
  rejectPresent(value, ["platform", "release", "desktop_session", "session_type"], "result", errors);
  requireBoolean(value.dbus_session_bus_available, "result.dbus_session_bus_available", errors);
  optionalBoolean(value.atspi_bus_address_available, "result.atspi_bus_address_available", errors);
  requireNonNegativeInteger(value.window_count, "result.window_count", errors);
  requireNonNegativeInteger(value.text_item_count, "result.text_item_count", errors);
  requireBoolean(value.bounded, "result.bounded", errors);
  if (value.bounded !== true) {
    errors.push("result.bounded must be true");
  }
  requireBoolean(value.truncated, "result.truncated", errors);
  requireNonNegativeInteger(value.max_windows, "result.max_windows", errors);
  requireNonNegativeInteger(value.max_nodes_per_window, "result.max_nodes_per_window", errors);
  requireNonNegativeInteger(value.max_text_items, "result.max_text_items", errors);
  requireNonNegativeInteger(value.max_text_chars_per_item, "result.max_text_chars_per_item", errors);
  if (value.titles_included !== true) {
    errors.push("result.titles_included must be true");
  }
  if (value.names_included !== true) {
    errors.push("result.names_included must be true");
  }
  if (value.descriptions_included !== true) {
    errors.push("result.descriptions_included must be true");
  }
  if (value.text_content_included !== true) {
    errors.push("result.text_content_included must be true");
  }
  if (value.identity_fields_included !== false) {
    errors.push("result.identity_fields_included must be false");
  }
  if (value.screenshots_included !== false) {
    errors.push("result.screenshots_included must be false");
  }
  if (!Array.isArray(value.withheld_fields)) {
    errors.push("result.withheld_fields must be an array");
  }
  optionalString(value.unavailable_reason, "result.unavailable_reason", errors);
  optionalString(value.diagnostic, "result.diagnostic", errors);
  optionalNonNegativeInteger(value.generation_id, "result.generation_id", errors);
  validateTextWindowArray(value.windows, "result.windows", errors, value);
}

function validateTextWindowArray(value, path, errors, result) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (Number.isInteger(result?.max_windows) && value.length > result.max_windows) {
    errors.push(`${path} must have at most result.max_windows items`);
  }
  value.forEach((window, index) => validateTextWindow(window, `${path}[${index}]`, errors, result));
}

function validateTextWindow(value, path, errors, result) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, TEXT_WINDOW_KEYS, path, errors);
  requireNonNegativeInteger(value.index, `${path}.index`, errors);
  requireNonNegativeInteger(value.z_order, `${path}.z_order`, errors);
  requireString(value.role, `${path}.role`, errors);
  requireNonNegativeInteger(value.child_count, `${path}.child_count`, errors);
  if (value.geometry !== null) {
    validateWindowGeometry(value.geometry, `${path}.geometry`, errors);
  }
  if (value.title !== null) {
    validateBoundedText(value.title, `${path}.title`, errors, result);
  }
  validateTextItemArray(value.text_items, `${path}.text_items`, errors, result);
  requireBoolean(value.truncated, `${path}.truncated`, errors);
}

function validateTextItemArray(value, path, errors, result) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (Number.isInteger(result?.max_text_items) && value.length > result.max_text_items) {
    errors.push(`${path} must have at most result.max_text_items items`);
  }
  value.forEach((item, index) => validateTextItem(item, `${path}[${index}]`, errors, result));
}

function validateTextItem(value, path, errors, result) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, TEXT_ITEM_KEYS, path, errors);
  requireStringEnum(value.kind, ["name", "description", "text"], `${path}.kind`, errors);
  requireString(value.role, `${path}.role`, errors);
  validateBoundedText(value.text, `${path}.text`, errors, result);
  optionalString(value.act_ref, `${path}.act_ref`, errors);
  optionalStringEnumArray(value.act_kinds, ACT_KINDS, `${path}.act_kinds`, errors);
}

function validateBoundedText(value, path, errors, result) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnexpectedKeys(value, BOUNDED_TEXT_KEYS, path, errors);
  requireString(value.value, `${path}.value`, errors);
  requireNonNegativeInteger(value.char_count, `${path}.char_count`, errors);
  requireBoolean(value.truncated, `${path}.truncated`, errors);
  if (
    typeof value.value === "string" &&
    Number.isInteger(result?.max_text_chars_per_item) &&
    [...value.value].length > result.max_text_chars_per_item
  ) {
    errors.push(`${path}.value must have at most result.max_text_chars_per_item characters`);
  }
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

function rejectPresent(value, keys, path, errors) {
  for (const key of keys) {
    if (value?.[key] !== undefined) {
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

function optionalStringEnumArray(value, allowed, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array when provided`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !allowed.has(entry)) {
      errors.push(`${path}[${index}] must be one of ${[...allowed].join(", ")}`);
    }
  });
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

function requireInteger(value, path, errors) {
  if (!Number.isInteger(value)) {
    errors.push(`${path} must be an integer`);
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
