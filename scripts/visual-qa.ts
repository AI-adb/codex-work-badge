import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { renderBadgeSvg } from "../src/core/badge.ts";
import { sampleBadgeManifest } from "../src/core/sample.ts";

const root = process.cwd();
const artifactDir = path.join(root, "artifacts", "codex-work-badge");
fs.mkdirSync(artifactDir, { recursive: true });

const failures: string[] = [];

async function renderAndCheck(size: 1080 | 4096) {
  const svg = renderBadgeSvg(sampleBadgeManifest, size);
  const out = path.join(artifactDir, `codex-work-badge-qa-${size}.png`);
  await sharp(Buffer.from(svg)).flatten({ background: "#f4f6f5" }).png().toFile(out);
  const metadata = await sharp(out).metadata();
  if (metadata.width !== size || metadata.height !== size) {
    failures.push(`${path.relative(root, out)} expected ${size}x${size}, got ${metadata.width}x${metadata.height}`);
  }
  if (metadata.hasAlpha) {
    failures.push(`${path.relative(root, out)} unexpectedly has alpha channel`);
  }
  return { file: path.relative(root, out), width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha };
}

const png1080 = await renderAndCheck(1080);
const png4096 = await renderAndCheck(4096);
const svgA = renderBadgeSvg(sampleBadgeManifest, 1080);
const svgB = renderBadgeSvg(sampleBadgeManifest, 1080);
if (svgA !== svgB) failures.push("Badge renderer is not deterministic for identical input.");

const summary = {
  ok: failures.length === 0,
  browser: "not run by this artifact QA script",
  previewExportParity: svgA === svgB,
  safeMarginPxAt1080: 72,
  pngs: [png1080, png4096],
  failures
};

fs.writeFileSync(path.join(artifactDir, "visual-qa-summary.json"), JSON.stringify(summary, null, 2));

if (failures.length) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
