#!/usr/bin/env node

import { spawnSync } from "node:child_process";

export const DEFAULT_GRAPHICAL_NODE_SMOKE = Object.freeze({
  host: "soma-agent-desktop.local.sthnet.org",
  user: "sherndon",
  primusHost: "primus.local.sthnet.org",
  domain: "soma-agent-desktop",
  vkcubeSeconds: 25,
  sshOptions: [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
  ],
});

export class GraphicalNodeSmokeError extends Error {
  constructor(message, code = "graphical_node_smoke_error") {
    super(message);
    this.name = "GraphicalNodeSmokeError";
    this.code = code;
  }
}

export function parseGraphicalNodeSmokeArgs(argv = []) {
  const options = {
    ...DEFAULT_GRAPHICAL_NODE_SMOKE,
    dryRun: false,
    json: false,
    launchVkcube: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--launch-vkcube") {
      options.launchVkcube = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new GraphicalNodeSmokeError(`unexpected positional argument: ${arg}`, "usage_error");
    }

    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new GraphicalNodeSmokeError(`${arg} requires a value`, "usage_error");
    }
    i += 1;

    switch (key) {
      case "host":
        options.host = value;
        break;
      case "user":
        options.user = value;
        break;
      case "primus-host":
        options.primusHost = value;
        break;
      case "domain":
        options.domain = value;
        break;
      case "vkcube-seconds":
        options.vkcubeSeconds = parsePositiveInteger(value, "--vkcube-seconds", 1, 120);
        break;
      default:
        throw new GraphicalNodeSmokeError(`unknown flag: ${arg}`, "usage_error");
    }
  }

  validateHostLike(options.host, "--host");
  validateHostLike(options.primusHost, "--primus-host");
  validateToken(options.user, "--user");
  validateToken(options.domain, "--domain");
  return options;
}

export function buildGraphicalNodeSmokePlan(options = DEFAULT_GRAPHICAL_NODE_SMOKE) {
  return [
    {
      label: "check VM state on Primus",
      command: ["ssh", options.primusHost, `sudo virsh domstate ${shellWord(options.domain)} | grep -qx running`],
    },
    {
      label: "check guest IP via qemu guest agent",
      command: ["ssh", options.primusHost, `sudo virsh domifaddr ${shellWord(options.domain)} --source agent | grep -E 'ipv4 +[0-9]'`],
    },
    {
      label: "check guest GPU and Sunshine state",
      command: ["ssh", ...options.sshOptions, `${options.user}@${options.host}`, guestReadOnlyCommand()],
    },
    {
      label: "check browser profile and keyring cleanliness",
      command: ["ssh", ...options.sshOptions, `${options.user}@${options.host}`, guestCleanlinessCommand()],
    },
    ...(options.launchVkcube
      ? [{
          label: "launch visible Vulkan cube",
          command: [
            "ssh",
            ...options.sshOptions,
            `${options.user}@${options.host}`,
            guestVkcubeCommand(options.vkcubeSeconds),
          ],
        }]
      : []),
  ];
}

export async function runGraphicalNodeSmoke({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  runner = runCommand,
} = {}) {
  const options = parseGraphicalNodeSmokeArgs(argv);
  const plan = buildGraphicalNodeSmokePlan(options);
  const results = [];

  if (!options.json) {
    stdout.write("Graphical node smoke plan:\n");
    for (const step of plan) {
      stdout.write(`- ${step.label}\n`);
      stdout.write(`  $ ${formatCommand(step.command)}\n`);
    }
    stdout.write("\n");
  }

  if (options.dryRun) {
    const result = { dry_run: true, plan };
    writeResult(stdout, result, options);
    return result;
  }

  for (const step of plan) {
    if (!options.json) {
      stdout.write(`Running: ${step.label}\n`);
    }
    const result = runner(step.command);
    results.push({
      label: step.label,
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    if (result.status !== 0) {
      const failure = {
        ok: false,
        failed_step: step.label,
        results,
      };
      writeResult(stdout, failure, options);
      throw new GraphicalNodeSmokeError(`graphical node smoke failed: ${step.label}`, "smoke_failed");
    }
  }

  const result = { ok: true, results };
  writeResult(stdout, result, options);
  return result;
}

export function formatCommand(command) {
  return command.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}

function writeResult(stdout, result, options) {
  if (options.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    stdout.write("Graphical node smoke passed.\n");
  } else if (result.dry_run) {
    stdout.write("Dry run requested; no commands executed.\n");
  }
}

function runCommand(command) {
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function guestReadOnlyCommand() {
  return [
    "set -euo pipefail",
    "printf 'HOSTNAME\\n'; hostname",
    "printf 'GPU\\n'; lspci -nn | grep -E 'VGA|3D|Display|NVIDIA'",
    "printf 'NVIDIA\\n'; nvidia-smi --query-gpu=name,driver_version,display_active,memory.total,encoder.stats.sessionCount --format=csv,noheader",
    "printf 'DRM_CONNECTORS\\n'; ls -1 /sys/class/drm | grep -E 'card[0-9]-' || true",
    "if ls -1 /sys/class/drm 2>/dev/null | grep -q 'Virtual'; then echo 'unexpected virtual DRM connector' >&2; exit 1; fi",
    "printf 'SUNSHINE\\n'; systemctl --user is-active app-dev.lizardbyte.app.Sunshine.service",
    "printf 'PORTS\\n'; ss -ltnp | grep -E '(:47984|:47989|:47990|:48010)'",
    "printf 'BROWSERS\\n'; google-chrome --version; microsoft-edge --version; firefox --version",
  ].join("; ");
}

function guestCleanlinessCommand() {
  return [
    "set -euo pipefail",
    "dirty=0",
    "printf 'PROFILE_PATHS\\n'",
    "for p in \"$HOME/.config/google-chrome\" \"$HOME/.cache/google-chrome\" \"$HOME/.config/microsoft-edge\" \"$HOME/.cache/microsoft-edge\" \"$HOME/.mozilla/firefox\" \"$HOME/.cache/mozilla\" \"$HOME/.config/chromium\" \"$HOME/.cache/chromium\"; do if [ -e \"$p\" ]; then echo \"$p\"; dirty=1; fi; done",
    "printf 'KEYRINGS\\n'",
    "if find \"$HOME/.local/share/keyrings\" -maxdepth 1 -type f -print -quit 2>/dev/null | grep -q .; then find \"$HOME/.local/share/keyrings\" -maxdepth 1 -type f -printf '%f\\n'; dirty=1; fi",
    "exit \"$dirty\"",
  ].join("; ");
}

function guestVkcubeCommand(seconds) {
  return [
    "set -euo pipefail",
    "export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
    "rm -f /tmp/vkcube-wayland.log",
    `(timeout ${seconds}s vkcube --wsi wayland --gpu_number 0 --width 1280 --height 720 > /tmp/vkcube-wayland.log 2>&1 &)`,
    "sleep 3",
    "pgrep -a vkcube",
    "nvidia-smi --query-gpu=name,utilization.gpu,memory.used,encoder.stats.sessionCount --format=csv,noheader",
    "sed -n '1,80p' /tmp/vkcube-wayland.log",
  ].join("; ");
}

function parsePositiveInteger(value, flag, min, max) {
  if (!/^[0-9]+$/.test(value)) {
    throw new GraphicalNodeSmokeError(`${flag} must be an integer from ${min} to ${max}`, "usage_error");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new GraphicalNodeSmokeError(`${flag} must be an integer from ${min} to ${max}`, "usage_error");
  }
  return parsed;
}

function validateHostLike(value, flag) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new GraphicalNodeSmokeError(`${flag} contains unsupported characters`, "usage_error");
  }
}

function validateToken(value, flag) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new GraphicalNodeSmokeError(`${flag} contains unsupported characters`, "usage_error");
  }
}

function shellWord(value) {
  validateToken(value, "shell word");
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGraphicalNodeSmoke().catch((error) => {
    if (error instanceof GraphicalNodeSmokeError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
}
