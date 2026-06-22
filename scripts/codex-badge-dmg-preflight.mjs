import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const failures = [];
const homeCargoBin = path.join(process.env.HOME || "", ".cargo", "bin");

const probes = {
  rustc: ["--version"],
  cargo: ["--version"],
  xattr: ["-h"],
  codesign: null,
  hdiutil: ["help"]
};

function resolveCommand(command) {
  const candidates = [
    command,
    path.join(homeCargoBin, command)
  ];
  return candidates.find((candidate) => {
    if (candidate.includes(path.sep)) return fs.existsSync(candidate);
    return spawnSync("sh", ["-lc", `command -v ${candidate}`], { encoding: "utf8" }).status === 0;
  }) || command;
}

function commandExists(command, resolved) {
  if (resolved.includes(path.sep)) return fs.existsSync(resolved);
  return spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" }).status === 0;
}

for (const command of ["rustc", "cargo", "xattr", "codesign", "hdiutil"]) {
  const resolved = resolveCommand(command);
  if (!commandExists(command, resolved)) {
    failures.push(`${command} is required to build the Tauri DMG`);
    continue;
  }

  if (probes[command]) {
    const result = spawnSync(resolved, probes[command], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      failures.push(`${command} is required to build the Tauri DMG`);
    }
  }
}

if (failures.length) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        blocked: true,
        reason: "Tauri DMG build needs Rust and the local macOS packaging tools before packaging can run.",
        failures
      },
      null,
      2
    )
  );
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, rustToolchain: "present" }, null, 2));
