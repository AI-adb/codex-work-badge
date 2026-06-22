import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const csvPath = path.join(root, "docs/qa/codex-work-badge-user-stories.csv");
const summaryPath = path.join(root, "artifacts/codex-work-badge/user-story-audit-summary.json");
const runGates = process.argv.includes("--run-gates");
const homeCargoBin = path.join(process.env.HOME || "", ".cargo", "bin");

const columns = [
  "id",
  "feature_area",
  "user_story",
  "expected_behavior",
  "source_of_truth",
  "test_method",
  "status",
  "last_result",
  "errors_found",
  "fix_status",
  "evidence",
  "notes"
];

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readJson(file) {
  try {
    return JSON.parse(read(file));
  } catch {
    return null;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header || header.join(",") !== columns.join(",")) {
    throw new Error(`Unexpected CSV header in ${csvPath}`);
  }
  return rows.filter((entry) => entry.length > 1).map((entry) => Object.fromEntries(columns.map((column, index) => [column, entry[index] || ""])));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(rows) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  fs.writeFileSync(csvPath, `${lines.join("\n")}\n`);
}

function resolveExecutable(command) {
  const homeCargoCandidate = path.join(homeCargoBin, command);
  if (fs.existsSync(homeCargoCandidate)) return homeCargoCandidate;
  const probe = spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return probe.status === 0 ? probe.stdout.trim() : command;
}

function runCommand(name, command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${homeCargoBin}:${process.env.PATH || ""}`,
      ...extraEnv
    }
  });
  return {
    name,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

const commandResults = {};
if (runGates) {
  for (const [name, command, args] of [
    ["doctor", "npm", ["run", "codex-badge:doctor"]],
    ["unit", "npm", ["run", "codex-badge:test"]],
    ["visual", "npm", ["run", "codex-badge:qa"]],
    ["typecheck", "npm", ["run", "codex-badge:typecheck"]],
    ["build", "npm", ["run", "codex-badge:build"]],
    ["nativeCheck", resolveExecutable("cargo"), ["check", "--manifest-path", "src-tauri/Cargo.toml"]],
    ["dmgPreflight", "node", ["scripts/codex-badge-dmg-preflight.mjs"]],
    ["dmg", "npm", ["run", "codex-badge:dmg"]]
  ]) {
    commandResults[name] = runCommand(name, command, args, name === "nativeCheck" ? { CARGO_HTTP_MULTIPLEXING: "false" } : {});
  }

  if (process.env.CODEX_BADGE_CDP) {
    commandResults.browser = runCommand("browser", "npm", ["run", "codex-badge:browser-qa"]);
  }
}

const appSource = read(path.join(root, "src/App.tsx"));
const badgeSource = read(path.join(root, "src/core/badge.ts"));
const qrSource = read(path.join(root, "src/core/qr.ts"));
const aggregationSource = read(path.join(root, "src/core/aggregation.ts"));
const outcomesSource = read(path.join(root, "src/core/outcomes.ts"));
const privacySource = read(path.join(root, "src/core/privacy.ts"));
const nodeSources = read(path.join(root, "src/core/nodeSources.ts"));
const nativeSource = read(path.join(root, "src-tauri/src/main.rs"));
const packageJson = read(path.join(root, "package.json"));
const dmgPreflight = read(path.join(root, "scripts/codex-badge-dmg-preflight.mjs"));
const loopManifestText = read(path.join(root, "docs/loops/codex-work-badge-build-gate/loop.manifest.json"));
const visualSummary = readJson(path.join(root, "artifacts/codex-work-badge/visual-qa-summary.json"));
const browserSummary = readJson(path.join(root, "artifacts/codex-work-badge/browser-qa/browser-action-summary.json"));
const dmgDir = path.join(root, "src-tauri/target/release/bundle/dmg");
const hasDmg = fs.existsSync(dmgDir) && fs.readdirSync(dmgDir).some((file) => file.endsWith(".dmg"));

const rustcPath = resolveExecutable("rustc");
const cargoPath = resolveExecutable("cargo");
const hasRust = spawnSync(rustcPath, ["--version"], { encoding: "utf8" }).status === 0 && spawnSync(cargoPath, ["--version"], { encoding: "utf8" }).status === 0;
const commandOk = (name) => !runGates || commandResults[name]?.ok;
const commandEvidence = (name) => (runGates ? `${name}:${commandResults[name]?.ok ? "ok" : "failed"}` : `${name}:not-run-by-audit`);
const visualOk = visualSummary?.ok === true && visualSummary.pngs?.some((png) => png.width === 4096 && png.height === 4096 && png.hasAlpha === false);
const browserOk = browserSummary?.passed === true;

function result(status, lastResult, errorsFound, fixStatus, evidence, notes = "") {
  return { status, lastResult, errorsFound, fixStatus, evidence, notes };
}

function pass(lastResult, evidence, notes = "") {
  return result("passed", lastResult, "", "none", evidence, notes);
}

function fail(lastResult, errorsFound, evidence, notes = "") {
  return result("needs_fix", lastResult, errorsFound, "open", evidence, notes);
}

function notVerified(lastResult, evidence, notes = "") {
  return result("not_verified", lastResult, "missing direct evidence", "open", evidence, notes);
}

function blocked(lastResult, evidence, notes = "") {
  return result("blocked_external", lastResult, "external toolchain missing", "blocked", evidence, notes);
}

const checks = {
  "CWB-001": () => browserOk && browserSummary.layout?.overflow === false ? pass("dashboard rendered without overflow", "browser-action-summary.json") : notVerified("browser layout proof missing or failed", "browser-action-summary.json"),
  "CWB-002": () => appSource.includes("sampleAggregate") && badgeSource.includes("createBadgeManifest") && commandOk("unit") ? pass("sample preview covered by badge/unit evidence", commandEvidence("unit")) : fail("sample preview evidence incomplete", "sample preview source or unit gate missing", "App.tsx; badge.ts"),
  "CWB-003": () => browserSummary?.rootInput === "/Users/<qa>/.codex" ? pass("root input retained edited value", "browser-action-summary.json") : notVerified("root input browser proof missing", "browser-action-summary.json"),
  "CWB-004": () => browserSummary?.scanResult?.moduleState === "success" && browserSummary?.scanResult?.progress === "100%" ? pass("scan all-time reached success and 100%", "browser-action-summary.json") : notVerified("scan all-time browser proof missing", "browser-action-summary.json"),
  "CWB-005": () => hasRust && commandOk("nativeCheck") ? pass("native scan source compiles under Cargo", commandEvidence("nativeCheck")) : blocked("native scan source present; Rust compile not available", "main.rs; cargo-check", "scan_codex_root source is present but native binary was not compiled"),
  "CWB-006": () => aggregationSource.includes("parseRolloutJsonl") && commandOk("unit") ? pass("rollout parser unit gate passed", commandEvidence("unit")) : fail("rollout parser unit evidence failed", "unit gate failed or parser missing", "aggregation.ts"),
  "CWB-007": () => nodeSources.includes("isPathInsideRoot") && aggregationSource.includes("skippedOutOfScope") && commandOk("unit") ? pass("filesystem allowlist covered by unit/source evidence", commandEvidence("unit")) : fail("filesystem safety evidence incomplete", "allowlist or unit gate missing", "nodeSources.ts; aggregation.ts"),
  "CWB-008": () => browserOk && browserSummary.layout ? pass("metrics panels covered by rendered layout proof", "browser-action-summary.json") : notVerified("metrics browser proof missing", "browser-action-summary.json"),
  "CWB-009": () => badgeSource.includes("chooseProfileName") && badgeSource.includes("chooseTier") && commandOk("unit") ? pass("profile and tier logic covered", commandEvidence("unit")) : fail("profile logic evidence incomplete", "profile logic or unit gate missing", "badge.ts"),
  "CWB-010": () => privacySource.includes("FORBIDDEN_PATTERNS") && commandOk("doctor") && commandOk("unit") ? pass("public manifest privacy covered by doctor/unit gates", `${commandEvidence("doctor")};${commandEvidence("unit")}`) : fail("privacy gate failed or missing", "doctor/unit did not pass", "privacy.ts"),
  "CWB-011": () => browserSummary?.layout?.hasCustomQr === true ? pass("custom profile URL rendered into QR metadata", "browser-action-summary.json") : notVerified("custom URL QR browser proof missing", "browser-action-summary.json"),
  "CWB-012": () => qrSource.includes("quietModules = 4") && badgeSource.includes("renderQrUrlSvg(manifest.shareUrl, 3, 4)") && commandOk("unit") ? pass("QR size and quiet zone covered", commandEvidence("unit")) : fail("QR scannability evidence incomplete", "quiet zone/size or unit gate missing", "qr.ts; badge.ts"),
  "CWB-013": () => browserSummary?.layout?.hasHolographicEdge === true && visualOk ? pass("holographic square token visual verified", "visual-qa-summary.json; browser-action-summary.json") : notVerified("visual token proof missing", "visual/browser summaries"),
  "CWB-014": () => appSource.includes("exportReady") && appSource.includes("PNG_RENDER_TIMEOUT_MS") && visualOk ? pass("export cache and bounded render evidence present", "App.tsx; visual-qa-summary.json") : fail("export cache evidence incomplete", "exportReady/timeout/visual QA missing", "App.tsx"),
  "CWB-015": () => browserSummary?.saved4096?.width === 4096 && browserSummary?.saved4096?.height === 4096 && browserSummary?.saved4096?.type === "image/png" ? pass("browser save wrote a 4096 PNG blob", "browser-action-summary.json") : notVerified("browser save proof missing", "browser-action-summary.json"),
  "CWB-016": () => browserSummary?.fallbackSave?.hasDownloadLink === true && browserSummary?.fallbackSave?.hasOpenLink === true ? pass("blocked browser save exposes fallback links", "browser-action-summary.json") : notVerified("save fallback proof missing", "browser-action-summary.json"),
  "CWB-017": () => browserSummary?.imageCopy?.copied === true && browserSummary?.imageCopy?.types?.includes("image/png") && browserSummary?.successLayout?.hasDownloadLink === false ? pass("browser copy writes image/png and no success fallback", "browser-action-summary.json") : notVerified("browser copy proof missing", "browser-action-summary.json"),
  "CWB-018": () => browserSummary?.fallbackCopy?.hasDownloadLink === true && browserSummary?.fallbackCopy?.hasOpenLink === true ? pass("blocked browser copy exposes fallback links", "browser-action-summary.json") : notVerified("copy fallback proof missing", "browser-action-summary.json"),
  "CWB-019": () => hasRust && commandOk("nativeCheck") ? pass("native save command compiles under Cargo", commandEvidence("nativeCheck")) : blocked("native save source present; Rust compile not available", "main.rs; cargo-check"),
  "CWB-020": () => hasRust && commandOk("nativeCheck") ? pass("native clipboard command compiles under Cargo", commandEvidence("nativeCheck")) : blocked("native clipboard source present; Rust compile not available", "main.rs; cargo-check"),
  "CWB-021": () => hasRust && commandOk("nativeCheck") ? pass("native Preview command compiles under Cargo", commandEvidence("nativeCheck")) : blocked("native Preview source present; Rust compile not available", "main.rs; cargo-check"),
  "CWB-022": () => browserSummary?.layout?.hasCopyCaption === false && browserSummary?.layout?.hasRevealButton === false ? pass("old export actions absent", "browser-action-summary.json") : fail("old export actions still visible", "Copy Caption or Reveal in Finder visible", "browser-action-summary.json"),
  "CWB-023": () => outcomesSource.includes("publicSafe") && commandOk("unit") ? pass("ledger publicSafe and redaction covered", commandEvidence("unit")) : fail("ledger evidence incomplete", "outcome parser or unit gate missing", "outcomes.ts"),
  "CWB-024": () => commandOk("doctor") ? pass("privacy doctor passed", commandEvidence("doctor")) : fail("privacy doctor failed", commandResults.doctor?.stderr || "doctor not passed", "privacy-doctor.ts"),
  "CWB-025": () => visualOk && commandOk("visual") ? pass("visual export QA passed for 1080 and 4096", `${commandEvidence("visual")};visual-qa-summary.json`) : fail("visual QA failed or missing", "visual QA not passing", "visual-qa-summary.json"),
  "CWB-026": () => browserOk && commandOk("browser") ? pass("browser interaction QA passed", `${commandEvidence("browser")};browser-action-summary.json`) : notVerified("browser QA not run or failed", "browser-action-summary.json", "set CODEX_BADGE_CDP to run live browser QA"),
  "CWB-027": () => commandOk("build") ? pass("codex-badge build passed", commandEvidence("build")) : fail("codex-badge build failed", commandResults.build?.stderr || "build not passed", "package.json"),
  "CWB-028": () => dmgPreflight.includes("rustc") && dmgPreflight.includes("cargo") && !hasRust ? blocked("DMG correctly blocked by missing Rust toolchain", "codex-badge-dmg-preflight") : commandOk("dmg") && hasDmg ? pass("DMG build produced an installable disk image", commandEvidence("dmg")) : fail("DMG build failed or produced no disk image", commandResults.dmg?.stderr || "dmg build did not pass", "codex-badge-dmg-build"),
  "CWB-029": () => loopManifestText.includes("codex-work-badge-qa-4096.png") && loopManifestText.includes("codex-badge:browser-qa") && loopManifestText.includes("8000000") ? pass("loop manifest aligned with 4K/browser QA", "loop.manifest.json") : fail("loop manifest outdated", "expected 4096 artifact, browser QA command, 8MB budget", "loop.manifest.json"),
  "CWB-030": () => packageJson.includes("codex-badge:doctor") && packageJson.includes("codex-badge:test") && packageJson.includes("codex-badge:qa") ? pass("quality gate includes core badge gates", "package.json") : fail("quality gate missing badge gates", "quality-gate:evaluate does not include badge doctor/test/qa", "package.json")
};

const rows = parseCsv(read(csvPath));
const checkedAt = new Date().toISOString();
const summary = {
  checkedAt,
  runGates,
  commandResults: Object.fromEntries(Object.entries(commandResults).map(([name, value]) => [name, { ok: value.ok, status: value.status }])),
  totals: { passed: 0, needs_fix: 0, blocked_external: 0, not_verified: 0 },
  failures: []
};

for (const row of rows) {
  const check = checks[row.id];
  const outcome = check ? check() : notVerified("no audit check registered", "script");
  row.status = outcome.status;
  row.last_result = outcome.lastResult;
  row.errors_found = outcome.errorsFound;
  row.fix_status = outcome.fixStatus;
  row.evidence = outcome.evidence;
  row.notes = [outcome.notes, `checked_at=${checkedAt}`].filter(Boolean).join(" | ");
  summary.totals[outcome.status] = (summary.totals[outcome.status] || 0) + 1;
  if (outcome.status === "needs_fix") summary.failures.push({ id: row.id, error: outcome.errorsFound });
}

writeCsv(rows);
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (summary.failures.length) {
  process.exit(1);
}
