#!/usr/bin/env node

import { readFile, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const templateUrl = new URL("../packaging/polkit/00-soma-systemd-provider.rules.in", import.meta.url);
const [unit, output] = process.argv.slice(2);

if (!unit || !/^[A-Za-z0-9_.@-]{1,200}\.service$/.test(unit) || unit.includes("\\")) {
  console.error("usage: generate-systemd-provider-polkit.mjs EXACT.service [OUTPUT]");
  process.exit(64);
}

const template = await readFile(fileURLToPath(templateUrl), "utf8");
const rendered = template.replaceAll("@@UNIT@@", unit);
if (rendered.includes("@@")) {
  throw new Error("unresolved polkit template marker");
}

if (output) {
  await writeFile(output, rendered, { encoding: "utf8", mode: 0o644, flag: "wx" });
  // writeFile's `mode` is masked by the process umask (e.g. umask 0077 -> 0600), which
  // strips the world-read bit polkitd needs to load the policy. chmod is umask-independent,
  // so force the exact 0644 after the exclusive create.
  await chmod(output, 0o644);
} else {
  process.stdout.write(rendered);
}
