const DEFAULT_VENDOR_ID = "8086";
const DEPTH_KEYWORDS = [
  "depth",
  "infrared",
  "infra red",
  "ir",
  "imu",
  "gyro",
  "accelerometer",
  "accel",
  "motion",
];
const COLOR_KEYWORDS = ["color", "rgb"];

export function buildRealSenseDeviceAllowPlan({
  devices = [],
  vendorId = DEFAULT_VENDOR_ID,
  productId,
} = {}) {
  const normalizedVendorId = normalizeHexId(vendorId, "vendorId");
  const normalizedProductId = normalizeOptionalHexId(productId, "productId");
  const matchingDevices = devices
    .map(normalizeDevice)
    .filter((device) => matchesRealSense(device, normalizedVendorId, normalizedProductId));
  const classified = matchingDevices.map(classifyDevice);
  const depthPreferred = classified.filter((device) => device.include_in_depth_preferred);
  const colorExcluded = classified.filter((device) => device.category === "color");
  const unresolved = classified.filter((device) => device.category === "unknown");
  const minimalDepthSetClean =
    depthPreferred.length > 0 &&
    colorExcluded.length > 0 &&
    unresolved.length === 0;

  return Object.freeze({
    schema_version: 1,
    vendor_id: normalizedVendorId,
    product_id: normalizedProductId,
    minimal_depth_set_preferred: true,
    minimal_depth_set_clean: minimalDepthSetClean,
    fallback_required: !minimalDepthSetClean,
    fallback_reason: fallbackReason({ depthPreferred, colorExcluded, unresolved }),
    device_allow: depthPreferred.map((device) => device.devname),
    excluded_color_nodes: colorExcluded.map((device) => device.devname),
    unresolved_nodes: unresolved.map((device) => device.devname),
    matched_nodes: classified.map((device) => ({
      devname: device.devname,
      subsystem: device.subsystem,
      category: device.category,
      reason: device.reason,
    })),
  });
}

function classifyDevice(device) {
  const haystack = searchableText(device);
  if (containsAny(haystack, COLOR_KEYWORDS)) {
    return {
      ...device,
      category: "color",
      include_in_depth_preferred: false,
      reason: "node metadata names a color or RGB stream",
    };
  }
  if (containsAny(haystack, DEPTH_KEYWORDS)) {
    return {
      ...device,
      category: "depth_related",
      include_in_depth_preferred: true,
      reason: "node metadata names a depth, IR, or IMU stream",
    };
  }
  if (device.devname.startsWith("/dev/bus/usb/")) {
    return {
      ...device,
      category: "control",
      include_in_depth_preferred: true,
      reason: "USB control node for the matched RealSense device",
    };
  }
  if (device.devname.startsWith("/dev/media")) {
    return {
      ...device,
      category: "control",
      include_in_depth_preferred: true,
      reason: "media graph control node for the matched RealSense device",
    };
  }
  if (device.devname.startsWith("/dev/hidraw")) {
    return {
      ...device,
      category: "depth_related",
      include_in_depth_preferred: true,
      reason: "hidraw IMU/control node for the matched RealSense device",
    };
  }
  return {
    ...device,
    category: "unknown",
    include_in_depth_preferred: false,
    reason: "node matched the RealSense device but stream role was not identifiable",
  };
}

function matchesRealSense(device, vendorId, productId) {
  const properties = device.properties;
  const deviceVendorId = firstHexProperty(properties, [
    "ID_VENDOR_ID",
    "ID_USB_VENDOR_ID",
    "ID_VENDOR_FROM_DATABASE",
  ]);
  const deviceProductId = firstHexProperty(properties, [
    "ID_MODEL_ID",
    "ID_USB_MODEL_ID",
    "ID_MODEL_FROM_DATABASE",
  ]);
  if (deviceVendorId !== vendorId) {
    return false;
  }
  return !productId || deviceProductId === productId;
}

function normalizeDevice(device) {
  if (!device || typeof device !== "object" || Array.isArray(device)) {
    throw new TypeError("device must be an object");
  }
  const devname = stringValue(device.devname || device.DEVNAME);
  if (!isAllowedDevicePath(devname)) {
    throw new TypeError("device devname must be an allowed /dev path");
  }
  return {
    devname,
    subsystem: stringValue(device.subsystem || device.SUBSYSTEM),
    properties: normalizeProperties(device.properties || device),
  };
}

function normalizeProperties(properties) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, stringValue(value)]),
  );
}

function fallbackReason({ depthPreferred, colorExcluded, unresolved }) {
  if (depthPreferred.length === 0) {
    return "no depth, IR, IMU, control, or media nodes were identified";
  }
  if (colorExcluded.length === 0) {
    return "no color node was identified, so device-level color exclusion was not proven";
  }
  if (unresolved.length > 0) {
    return "one or more matched nodes could not be classified by stream role";
  }
  return "";
}

function searchableText(device) {
  return [
    device.devname,
    device.subsystem,
    ...Object.values(device.properties),
  ]
    .join(" ")
    .toLowerCase();
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function firstHexProperty(properties, names) {
  for (const name of names) {
    const value = normalizeHexIdOrEmpty(properties[name]);
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeOptionalHexId(value, label) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return normalizeHexId(value, label);
}

function normalizeHexId(value, label) {
  const text = normalizeHexIdOrEmpty(value);
  if (!text) {
    throw new TypeError(`${label} must be a 4-digit hexadecimal id`);
  }
  return text;
}

function normalizeHexIdOrEmpty(value) {
  const text = stringValue(value).toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{4}$/.test(text) ? text : "";
}

function isAllowedDevicePath(path) {
  return [
    "/dev/bus/usb/",
    "/dev/video",
    "/dev/media",
    "/dev/hidraw",
  ].some((prefix) => path.startsWith(prefix));
}

function stringValue(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
