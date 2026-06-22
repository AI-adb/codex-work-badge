import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const homeCargoBin = path.join(process.env.HOME || "", ".cargo", "bin");
const tauriCli = path.join(root, "node_modules", ".bin", "tauri");
const appPath = path.join(root, "src-tauri/target/release/bundle/macos/Codex Work Badge.app");
const dmgDir = path.join(root, "src-tauri/target/release/bundle/dmg");
const dmgPath = path.join(dmgDir, "Codex Work Badge_0.1.0_aarch64.dmg");
const env = {
  ...process.env,
  PATH: `${homeCargoBin}:${process.env.PATH || ""}`,
  CARGO_HTTP_MULTIPLEXING: "false"
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`.trim());
  }
  return result;
}

function runAllowFail(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env
  });
}

run("node", ["scripts/codex-badge-dmg-preflight.mjs"], { inherit: true });
run("npm", ["run", "build"], { inherit: true });

const tauriResult = runAllowFail(tauriCli, [
  "build",
  "--config",
  "src-tauri/tauri.conf.json",
  "--bundles",
  "dmg"
]);

if (tauriResult.status !== 0) {
  const output = `${tauriResult.stdout}\n${tauriResult.stderr}`;
  const recoverableBundleFailure = fs.existsSync(appPath)
    && (
      output.includes("bundle_dmg.sh")
      || output.includes("resource fork, Finder information, or similar detritus not allowed")
      || output.includes("failed to bundle project")
    );
  if (!recoverableBundleFailure) {
    throw new Error(`tauri build failed before a recoverable app bundle was available\n${output}`.trim());
  }

  run("xattr", ["-cr", appPath]);
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  fs.mkdirSync(dmgDir, { recursive: true });
  run("hdiutil", ["create", "-volname", "Codex Work Badge", "-srcfolder", appPath, "-ov", "-format", "UDZO", dmgPath]);
}

const dmgFiles = fs.existsSync(dmgDir)
  ? fs.readdirSync(dmgDir).filter((file) => file.endsWith(".dmg")).map((file) => path.join(dmgDir, file))
  : [];
if (!dmgFiles.length) {
  throw new Error("DMG build completed without producing a .dmg file.");
}

console.log(JSON.stringify({ ok: true, dmg: dmgFiles.map((file) => path.relative(root, file)) }, null, 2));
