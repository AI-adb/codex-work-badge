import { createBadgeManifest, renderBadgeSvg } from "./badge";
import { assertPublicManifestSafe } from "./privacy";
import { sampleAggregate, sampleOutcomes, zeroAggregate } from "./sample";

it("creates a public-safe manifest with at most three chips", () => {
  const manifest = createBadgeManifest(sampleAggregate, sampleOutcomes);
  expect(manifest.chips.length).toBeLessThanOrEqual(3);
  expect(manifest.title).toBe("Codex Merit Token");
  expect(manifest.profileName).toBe("Mission Commander");
  expect(manifest.heroMetric.label).toBe("Verified Codex hours");
  expect(manifest.heroMetric.value).toBe("257");
  expect(manifest.shareUrl).toBe("https://x.com/anthonydibe");
  expect(manifest.activityProof.stats).toEqual([
    { label: "Lifetime tokens", value: "18.4m" },
    { label: "Peak tokens", value: "4.2m" },
    { label: "Peak sessions", value: "72" },
    { label: "Latest streak", value: "4d" },
    { label: "Longest streak", value: "4d" }
  ]);
  expect(manifest.activityProof.intensity).toHaveLength(250);
  expect(manifest.confidenceStrip).toContain("Codex Merit Card");
  expect(() => assertPublicManifestSafe(manifest)).not.toThrow();
});

it("creates a clear zero-state manifest before scan", () => {
  const manifest = createBadgeManifest(zeroAggregate, []);

  expect(manifest.profileName).toBe("No Scan Yet");
  expect(manifest.profileSubtitle).toBe("Awaiting local Codex data");
  expect(manifest.heroMetric).toEqual({ label: "Verified sessions", value: "0" });
  expect(manifest.caption).toBe("No scan yet. Local Codex merit card will update after Scan all-time.");
  expect(manifest.activityProof.stats).toEqual([
    { label: "Lifetime tokens", value: "0" },
    { label: "Peak tokens", value: "0" },
    { label: "Peak sessions", value: "0" },
    { label: "Latest streak", value: "0d" },
    { label: "Longest streak", value: "0d" }
  ]);
});

it("renders a deterministic square svg with no local paths", () => {
  const manifest = createBadgeManifest(sampleAggregate, sampleOutcomes);
  const svg = renderBadgeSvg(manifest, 1080);
  expect(svg).toContain('width="1080"');
  expect(svg).toContain('height="1080"');
  expect(svg).toContain('viewBox="0 0 1080 1080"');
  expect(svg).toContain("Mission Commander");
  expect(svg).toContain("Verified Codex hours");
  expect(svg).toContain('id="holographic-edge"');
  expect(svg).toContain("holoEdge");
  expect(svg).not.toContain('x="50" y="50" width="980" height="980"');
  expect(svg).not.toContain('x="72" y="72" width="936" height="936"');
  expect(svg).not.toContain('id="signal-stack"');
  expect(svg).not.toContain("SIGNAL STACK");
  expect(svg).toContain('id="security-glyph"');
  expect(svg).toContain('id="holographic-label"');
  expect(svg).toContain('id="holo-rosette"');
  expect(svg).toContain('id="crypto-frame"');
  expect(svg).toContain('id="crypto-hash-strip"');
  expect(svg).toContain('id="crypto-checksum-grid"');
  expect(svg).toContain('id="profile-url-qr"');
  expect(svg).toContain('data-profile-url="https://x.com/anthonydibe"');
  expect(svg).toContain('data-quiet-modules="4"');
  expect(svg).toContain('width="135" height="135" fill="#ffffff"');
  expect(svg).toContain("holoRainbow");
  expect(svg).toContain("holoLattice");
  expect(svg).toContain("PROFILE URL");
  expect(svg).toContain('id="activity-rail"');
  expect(svg).toContain('id="activity-stat-ribbon"');
  expect(svg).toContain('id="activity-lattice"');
  expect(svg).toContain("Codex activity");
  expect(svg).toContain("PUBLIC-SAFE DAILY SIGNAL");
  expect(svg).toContain("Lifetime tokens");
  expect(svg).toContain("18.4m");
  expect(svg).not.toContain("Top active day");
  expect(svg).not.toContain("M74 72H220");
  expect(svg).not.toContain("M112 138H404M746 138H968");
  expect(svg).not.toContain('y="177" text-anchor="middle"');
  expect(svg).not.toContain(">WEEKLY</text>");
  expect(svg).not.toContain(">CUMULATIVE</text>");
  expect(svg).not.toContain(">EARLY</text>");
  expect(svg).not.toContain(">MID</text>");
  expect(svg).not.toContain(">RECENT</text>");
  expect(svg).not.toContain('id="metric-dock"');
  expect(svg).not.toContain('id="rank-plaque"');
  expect(svg).not.toContain("rankPlate");
  expect(svg).not.toContain("rankEdge");
  expect(svg).not.toContain("M0 76C74 26 160 24 238 76");
  expect(svg).not.toContain("M22 0H180L208 28V74");
  expect(svg).not.toContain("holoGlyph");
  expect(svg).not.toContain("cryptoFoil");
  expect(svg).not.toContain("crypto-guilloche");
  expect(svg).not.toContain("crypto-rosette");
  expect(svg).not.toContain("#42d8d4");
  expect(svg).not.toContain("PRIVACY CHECK");
  expect(svg).not.toContain("SHARE SAFE");
  expect(svg).not.toContain("NO PROMPTS");
  expect(svg).not.toContain("/Users/");
  expect(svg).not.toContain("undefined");
});

it("keeps exported badge bands visually separated", () => {
  const manifest = createBadgeManifest(sampleAggregate, sampleOutcomes);
  const svg = renderBadgeSvg(manifest, 1080);

  const securityY = Number(svg.match(/id="security-glyph" transform="translate\(622 (\d+)\)"/)?.[1]);
  const activityY = Number(svg.match(/id="activity-rail" transform="translate\(112 (\d+)\)"/)?.[1]);
  const allTimeY = Number(svg.match(/<text x="112" y="(\d+)"[^>]*font-size="42"[^>]*>All-time Codex run<\/text>/)?.[1]);

  expect(securityY).toBeGreaterThanOrEqual(340);
  expect(securityY + 194).toBeLessThan(620);
  expect(allTimeY).toBeLessThan(activityY);
  expect(activityY).toBeGreaterThanOrEqual(740);
  expect(svg).toContain('id="activity-lattice" transform="translate(24 144)"');
  expect(svg).toContain('width="812" height="55"');
});
