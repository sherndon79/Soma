const DEFAULT_USER = "soma-sensorium";
const DEFAULT_GROUP = "soma-sensorium";
const DEFAULT_RUNTIME_DIRECTORY = "soma/sensorium";

export function buildSensoriumHelperSandboxPlan({
  binaryPath = "/usr/libexec/soma/soma-sensor-broker",
  user = DEFAULT_USER,
  group = DEFAULT_GROUP,
  devicePaths = [],
  usbDevicePaths,
  runtimeDirectory = DEFAULT_RUNTIME_DIRECTORY,
} = {}) {
  const normalizedBinaryPath = requireAbsolutePath(binaryPath, "binaryPath");
  const normalizedUser = requireName(user, "user");
  const normalizedGroup = requireName(group, "group");
  const normalizedRuntimeDirectory = requireRuntimeDirectory(runtimeDirectory);
  const requestedDevicePaths = usbDevicePaths ?? devicePaths;
  const normalizedDevices = requestedDevicePaths.map((devicePath) =>
    requireDevicePath(devicePath, "devicePaths"),
  );

  return Object.freeze({
    schema_version: 1,
    service_name: "soma-sensor-broker.service",
    helper_binary: normalizedBinaryPath,
    isolation_model: "dedicated_user_network_denied_device_scoped",
    live_depth_presence_allowed: false,
    live_depth_presence_blocker:
      "presence derivation must move into this sandbox before raw depth may be subscribed",
    systemd_unit: Object.freeze({
      Unit: Object.freeze({
        Description: "Soma Sensorium helper sandbox",
        After: "systemd-udev-settle.service",
        StartLimitIntervalSec: "60s",
        StartLimitBurst: 3,
      }),
      Service: Object.freeze({
        Type: "simple",
        ExecStart: normalizedBinaryPath,
        User: normalizedUser,
        Group: normalizedGroup,
        UMask: "0077",
        Environment: "SOMA_SENSORIUM_LIVE_DEPTH_PRESENCE_ALLOWED=false",
        UnsetEnvironment: "LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT",
        NoNewPrivileges: "yes",
        CapabilityBoundingSet: "",
        AmbientCapabilities: "",
        PrivateNetwork: "yes",
        IPAddressDeny: "any",
        PrivateTmp: "yes",
        ProtectSystem: "strict",
        ProtectHome: "yes",
        ProtectKernelTunables: "yes",
        ProtectKernelModules: "yes",
        ProtectKernelLogs: "yes",
        ProtectControlGroups: "yes",
        ProtectHostname: "yes",
        ProtectClock: "yes",
        RestrictNamespaces: "yes",
        RestrictSUIDSGID: "yes",
        ReadWritePaths: [`/run/${normalizedRuntimeDirectory}`],
        RuntimeDirectory: normalizedRuntimeDirectory,
        RuntimeDirectoryMode: "0700",
        DevicePolicy: "closed",
        DeviceAllow: normalizedDevices,
        RestrictAddressFamilies: ["AF_UNIX"],
        LockPersonality: "yes",
        MemoryDenyWriteExecute: "yes",
        RestrictRealtime: "yes",
        SystemCallArchitectures: "native",
        SystemCallFilter: ["@system-service", "~@mount @module @raw-io @reboot @swap @keyring"],
        ProcSubset: "pid",
        ProtectProc: "invisible",
        RemoveIPC: "yes",
        Restart: "on-failure",
        RestartSec: "5s",
        TimeoutStopSec: "10s",
        LimitNOFILE: 128,
        MemoryMax: "256M",
        TasksMax: 32,
      }),
    }),
  });
}

export function assertSensoriumHelperSandboxPlan(plan = {}) {
  const service = plan.systemd_unit?.Service ?? {};
  const findings = [];

  if (plan.live_depth_presence_allowed !== false) {
    findings.push("live_depth_presence_allowed must remain false until helper-side presence exists");
  }
  if (!service.User || service.User === "root") {
    findings.push("Service.User must be a dedicated non-root sensorium user");
  }
  if (service.PrivateNetwork !== "yes") {
    findings.push("Service.PrivateNetwork must be yes");
  }
  if (service.IPAddressDeny !== "any") {
    findings.push("Service.IPAddressDeny must be any");
  }
  if (service.DevicePolicy !== "closed") {
    findings.push("Service.DevicePolicy must be closed");
  }
  if (!Array.isArray(service.DeviceAllow) || service.DeviceAllow.length === 0) {
    findings.push("Service.DeviceAllow must explicitly scope the RealSense USB device");
  }
  if (service.ProtectSystem !== "strict") {
    findings.push("Service.ProtectSystem must be strict");
  }
  if (service.ProtectHome !== "yes") {
    findings.push("Service.ProtectHome must be yes");
  }
  if (service.NoNewPrivileges !== "yes") {
    findings.push("Service.NoNewPrivileges must be yes");
  }
  if (service.Environment !== "SOMA_SENSORIUM_LIVE_DEPTH_PRESENCE_ALLOWED=false") {
    findings.push("Service.Environment must keep live depth presence disabled");
  }
  if (service.RuntimeDirectoryMode !== "0700") {
    findings.push("Service.RuntimeDirectoryMode must be 0700");
  }
  if (service.Restart !== "on-failure") {
    findings.push("Service.Restart must be on-failure");
  }
  const writePaths = Array.isArray(service.ReadWritePaths) ? service.ReadWritePaths : [];
  if (writePaths.some((entry) => entry !== `/run/${service.RuntimeDirectory}`)) {
    findings.push("Service.ReadWritePaths must be limited to the runtime directory");
  }

  if (findings.length > 0) {
    const error = new Error(`Sensorium helper sandbox plan is invalid: ${findings.join("; ")}`);
    error.code = "sensorium_helper_sandbox_plan_invalid";
    error.findings = findings;
    throw error;
  }

  return true;
}

function requireAbsolutePath(value, label) {
  const text = stringValue(value);
  if (!text.startsWith("/") || text.includes("\n")) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return text;
}

function requireDevicePath(value, label) {
  const text = requireAbsolutePath(value, label);
  const allowedPrefixes = ["/dev/bus/usb/", "/dev/video", "/dev/media", "/dev/hidraw"];
  if (!allowedPrefixes.some((prefix) => text.startsWith(prefix))) {
    throw new TypeError(
      `${label} must point under /dev/bus/usb, /dev/video, /dev/media, or /dev/hidraw`,
    );
  }
  return text;
}

function requireName(value, label) {
  const text = stringValue(value);
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(text)) {
    throw new TypeError(`${label} must be a safe system account name`);
  }
  return text;
}

function requireRuntimeDirectory(value) {
  const text = stringValue(value);
  if (!/^[a-z0-9_/-]+$/.test(text) || text.startsWith("/") || text.includes("..")) {
    throw new TypeError("runtimeDirectory must be a relative runtime directory");
  }
  return text;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
