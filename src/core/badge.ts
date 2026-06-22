import { assertPublicManifestSafe } from "./privacy.ts";
import { renderQrUrlSvg } from "./qr.ts";
import type { BadgeManifest, CodexAggregate, OutcomeLedgerEntry } from "./types.ts";

export const DEFAULT_SHARE_URL = "https://x.com/yourprofile";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: value >= 100000 ? "compact" : "standard" }).format(value);
}

function formatHours(minutes: number): string {
  const hours = Math.max(0, minutes / 60);
  return hours >= 10 ? Math.round(hours).toString() : hours.toFixed(1);
}

function chooseTier(aggregate: CodexAggregate): BadgeManifest["tier"] {
  if (aggregate.activeMinutesEstimate >= 7200 || aggregate.toolCalls >= 500) return "Operator";
  if (aggregate.activeMinutesEstimate >= 1440 || aggregate.toolCalls >= 160) return "Shipper";
  if (aggregate.sessions >= 10 || aggregate.assistantMessages >= 80 || aggregate.activeMinutesEstimate >= 300) return "Builder";
  return "Seed";
}

function chooseProfileName(aggregate: CodexAggregate, artifacts: number, gates: number): { name: string; subtitle: string } {
  const hours = aggregate.activeMinutesEstimate / 60;
  const messages = aggregate.userMessages + aggregate.assistantMessages;
  const toolIntensity = aggregate.sessions > 0 ? aggregate.toolCalls / aggregate.sessions : 0;

  if (artifacts >= 25 && gates >= 50) {
    return { name: "Mission Commander", subtitle: "High-output delivery profile" };
  }
  if (hours >= 120 && toolIntensity >= 5) {
    return { name: "Systems Architect", subtitle: "Long-cycle work with heavy tool leverage" };
  }
  if (toolIntensity >= 8) {
    return { name: "Automation Tactician", subtitle: "Tool-dense execution profile" };
  }
  if (messages >= 1000 && hours >= 40) {
    return { name: "Deep Work Strategist", subtitle: "Sustained Codex collaboration profile" };
  }
  if (aggregate.sessions >= 30) {
    return { name: "Iteration Builder", subtitle: "Consistent session-by-session operator" };
  }
  return { name: "Codex Initiate", subtitle: "Early verified local usage profile" };
}

export function createBadgeManifest(
  aggregate: CodexAggregate,
  outcomes: OutcomeLedgerEntry[],
  privacyMode: BadgeManifest["privacyMode"] = "private",
  shareUrl = DEFAULT_SHARE_URL
): BadgeManifest {
  const verifiedOutcomes = outcomes.filter((entry) => entry.publicSafe);
  const artifacts = verifiedOutcomes.reduce((sum, entry) => sum + Math.max(0, entry.artifactsShipped || 0), 0);
  const bugs = verifiedOutcomes.reduce((sum, entry) => sum + Math.max(0, entry.bugsResolved || 0), 0);
  const gates = verifiedOutcomes.reduce((sum, entry) => sum + Math.max(0, entry.gatesPassed || 0), 0);

  const profile = chooseProfileName(aggregate, artifacts, gates);
  const heroMetric =
    aggregate.activeMinutesEstimate > 0
      ? { label: "Verified Codex hours", value: formatHours(aggregate.activeMinutesEstimate) }
      : { label: "Verified sessions", value: formatNumber(aggregate.sessions) };

  const chips = [
    aggregate.sessions > 0 ? { label: "Sessions", value: formatNumber(aggregate.sessions) } : null,
    aggregate.userMessages + aggregate.assistantMessages > 0
      ? { label: "Exchanges", value: formatNumber(aggregate.userMessages + aggregate.assistantMessages) }
      : null,
    aggregate.toolCalls > 0 ? { label: "Tool runs", value: formatNumber(aggregate.toolCalls) } : null,
    artifacts > 0 ? { label: "Verified wins", value: formatNumber(artifacts) } : null,
    gates > 0 ? { label: "Gates", value: formatNumber(gates) } : null,
    bugs > 0 ? { label: "Bugs fixed", value: formatNumber(bugs) } : null
  ].filter((chip): chip is { label: string; value: string } => Boolean(chip)).slice(0, 3);

  const confidenceStrip = `Codex Merit Card | ${aggregate.periodLabel}`;
  const manifest: BadgeManifest = {
    title: "Codex Merit Token",
    period: aggregate.periodLabel,
    profileName: profile.name,
    profileSubtitle: profile.subtitle,
    heroMetric,
    chips,
    tier: chooseTier(aggregate),
    confidenceStrip,
    privacyMode,
    shareUrl,
    caption: `${profile.name}: ${heroMetric.value} ${heroMetric.label.toLowerCase()} across ${aggregate.periodLabel}. Local Codex merit card.`,
    altText: `Square Codex Merit Token named ${profile.name}, showing ${heroMetric.value} ${heroMetric.label.toLowerCase()} for ${aggregate.periodLabel}.`
  };

  assertPublicManifestSafe(manifest);
  return manifest;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function publicDigest(manifest: BadgeManifest): string {
  const source = [
    manifest.title,
    manifest.period,
    manifest.profileName,
    manifest.profileSubtitle,
    manifest.heroMetric.label,
    manifest.heroMetric.value,
    manifest.shareUrl,
    manifest.tier,
    manifest.chips.map((chip) => `${chip.label}:${chip.value}`).join(",")
  ].join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function nextSeed(seed: number): number {
  let value = seed || 0x9e3779b9;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function renderHoloRings(digest: string): string {
  const palette = ["#ff6f91", "#ffe66d", "#62f7b4", "#57d8ff", "#8c83ff", "#ff9de2"];
  const seed = parseInt(digest, 16) || 1;
  return Array.from({ length: 56 }, (_, index) => {
    const color = palette[(index + seed) % palette.length];
    const angle = Math.round(index * 6.43);
    const opacity = (0.22 + (index % 5) * 0.05).toFixed(2);
    const rx = 52 - (index % 4) * 4;
    const ry = 14 + (index % 5) * 2;
    return `<ellipse rx="${rx}" ry="${ry}" transform="rotate(${angle})" fill="none" stroke="${color}" stroke-width="1.1" opacity="${opacity}"/>`;
  }).join("");
}

function renderHoloPixels(digest: string): string {
  const palette = ["#ff6f91", "#ffe66d", "#62f7b4", "#57d8ff", "#8c83ff", "#ff9de2"];
  let seed = parseInt(digest, 16) || 1;
  return Array.from({ length: 40 }, (_, index) => {
    seed = nextSeed(seed + index);
    const x = 8 + (seed % 122);
    const y = 8 + ((seed >>> 8) % 76);
    const width = 3 + ((seed >>> 16) % 9);
    const height = 3 + ((seed >>> 22) % 16);
    const color = palette[(seed >>> 12) % palette.length];
    const opacity = (0.26 + ((seed >>> 4) % 5) * 0.08).toFixed(2);
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" opacity="${opacity}"/>`;
  }).join("");
}

export function renderBadgeSvg(manifest: BadgeManifest, size = 1080): string {
  const metricUnit = manifest.heroMetric.label.toLowerCase().includes("session") ? "sessions" : "hours";
  const cellCount = Math.max(1, manifest.chips.length);
  const cellWidth = 856 / cellCount;
  const digest = publicDigest(manifest);
  const digestLabel = `${digest.slice(0, 4)}-${digest.slice(4)}`;
  const holoRings = renderHoloRings(digest);
  const holoPixels = renderHoloPixels(digest);
  const profileQr = renderQrUrlSvg(manifest.shareUrl, 3, 4);
  const chips = manifest.chips.map((chip, index) => {
    const x = index * cellWidth;
    return `
      <g transform="translate(${x} 0)">
        ${index > 0 ? `<path d="M0 18V104" stroke="#ccd6d8" stroke-width="2"/>` : ""}
        <path d="M28 28H${Math.max(128, cellWidth - 42)}" stroke="#255f62" stroke-width="2" opacity="0.5"/>
        <text x="28" y="60" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" fill="#5f696d">${escapeXml(chip.label)}</text>
        <text x="28" y="96" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="33" font-weight="850" fill="#171716">${escapeXml(chip.value)}</text>
      </g>`;
  }).join("");
  const signalRows = manifest.chips.map((chip, index) => {
    const y = index * 62;
    const trackWidth = [198, 172, 214][index] ?? 186;
    return `
      <g transform="translate(0 ${y})">
        <text x="0" y="17" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" fill="#5f696d">${escapeXml(chip.label.toUpperCase())}</text>
        <text x="236" y="17" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" font-weight="760" fill="#171716">${escapeXml(chip.value)}</text>
        <rect x="0" y="31" width="236" height="8" rx="4" fill="#e6ecec"/>
        <rect x="0" y="31" width="${trackWidth}" height="8" rx="4" fill="#255f62"/>
        <circle cx="${trackWidth}" cy="35" r="7" fill="#ffffff" stroke="#255f62" stroke-width="3"/>
      </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1080 1080" role="img" aria-label="${escapeXml(manifest.altText)}">
  <defs>
    <linearGradient id="holoEdge" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#f7fdff"/>
      <stop offset="0.14" stop-color="#58d8ff"/>
      <stop offset="0.28" stop-color="#9b8cff"/>
      <stop offset="0.46" stop-color="#ff8db8"/>
      <stop offset="0.62" stop-color="#ffe66d"/>
      <stop offset="0.8" stop-color="#6ff2c0"/>
      <stop offset="1" stop-color="#1f4d63"/>
    </linearGradient>
    <linearGradient id="holoEdgeInk" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#111418"/>
      <stop offset="0.48" stop-color="#8fa2a6"/>
      <stop offset="1" stop-color="#255f62"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.58" stop-color="#f7f9f8"/>
      <stop offset="1" stop-color="#edf2f1"/>
    </linearGradient>
    <linearGradient id="holoSilver" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#eef3f2"/>
      <stop offset="0.18" stop-color="#aeb9ba"/>
      <stop offset="0.36" stop-color="#ffffff"/>
      <stop offset="0.58" stop-color="#bfc8c8"/>
      <stop offset="0.78" stop-color="#f8fbfa"/>
      <stop offset="1" stop-color="#9aa5a8"/>
    </linearGradient>
    <linearGradient id="holoStripe" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#9aa5a8"/>
      <stop offset="0.22" stop-color="#ffffff"/>
      <stop offset="0.42" stop-color="#7d8789"/>
      <stop offset="0.62" stop-color="#ffffff"/>
      <stop offset="0.82" stop-color="#b8c2c3"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <radialGradient id="holoRainbow" cx="42%" cy="42%" r="64%">
      <stop offset="0" stop-color="#fff3a8" stop-opacity="0.88"/>
      <stop offset="0.2" stop-color="#ff7ea8" stop-opacity="0.82"/>
      <stop offset="0.38" stop-color="#8f8cff" stop-opacity="0.78"/>
      <stop offset="0.56" stop-color="#62dfff" stop-opacity="0.76"/>
      <stop offset="0.72" stop-color="#7df2b2" stop-opacity="0.74"/>
      <stop offset="0.86" stop-color="#ffe66d" stop-opacity="0.76"/>
      <stop offset="1" stop-color="#ff6f91" stop-opacity="0.7"/>
    </radialGradient>
    <radialGradient id="holoOrb" cx="48%" cy="44%" r="58%">
      <stop offset="0" stop-color="#fff3a8" stop-opacity="0.9"/>
      <stop offset="0.28" stop-color="#ff8daf" stop-opacity="0.82"/>
      <stop offset="0.5" stop-color="#57d8ff" stop-opacity="0.78"/>
      <stop offset="0.74" stop-color="#8c83ff" stop-opacity="0.66"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.18"/>
    </radialGradient>
    <clipPath id="holoLabelClip">
      <path d="M0 20L20 0H326L346 20V174L326 194H20L0 174Z"/>
    </clipPath>
    <pattern id="holoLattice" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M18 0V36M0 18H36M0 0L36 36M36 0L0 36" stroke="#ffffff" stroke-width="1.2" opacity="0.45"/>
      <circle cx="18" cy="18" r="7" fill="none" stroke="#ffffff" stroke-width="1.1" opacity="0.5"/>
      <circle cx="0" cy="0" r="3" fill="#ffffff" opacity="0.42"/>
      <circle cx="36" cy="36" r="3" fill="#ffffff" opacity="0.42"/>
    </pattern>
    <pattern id="cryptoMicrogrid" width="8" height="8" patternUnits="userSpaceOnUse">
      <path d="M8 0H0V8" fill="none" stroke="#1f4d63" stroke-width="0.55" opacity="0.12"/>
    </pattern>
    <pattern id="paper" width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M0 28L28 0" stroke="#9aa5a8" stroke-width="1" opacity="0.08"/>
      <path d="M14 28L28 14" stroke="#255f62" stroke-width="1" opacity="0.045"/>
    </pattern>
  </defs>
  <rect width="1080" height="1080" fill="#f4f6f5"/>
  <rect width="1080" height="1080" fill="url(#paper)"/>
  <rect id="holographic-edge" x="42" y="42" width="996" height="996" rx="42" fill="url(#panel)" stroke="url(#holoEdge)" stroke-width="7"/>
  <rect x="50" y="50" width="980" height="980" rx="36" fill="none" stroke="url(#holoEdgeInk)" stroke-width="2" opacity="0.58"/>
  <path d="M74 72H220M860 72H1006M72 858V1006M1006 74V222" stroke="url(#holoEdge)" stroke-width="3" opacity="0.72"/>
  <rect x="72" y="72" width="936" height="936" rx="28" fill="none" stroke="#cbd5d7" stroke-width="2"/>
  <path d="M112 258H968M112 760H968M112 930H968" stroke="#ccd6d8" stroke-width="2"/>
  <path d="M112 138H404M746 138H968" stroke="#255f62" stroke-width="3"/>
  <text x="112" y="166" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" fill="#315f5c">${escapeXml(manifest.title)}</text>
  <text x="112" y="225" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="58" font-weight="880" fill="#171716">${escapeXml(manifest.profileName)}</text>
  <text x="112" y="312" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="30" font-weight="720" fill="#242B33">${escapeXml(manifest.profileSubtitle)}</text>
  <text x="112" y="400" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="21" fill="#5f696d">${escapeXml(manifest.heroMetric.label)}</text>
  <text x="108" y="574" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="166" font-weight="920" fill="#171716">${escapeXml(manifest.heroMetric.value)}</text>
  <text x="420" y="558" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="48" font-weight="780" fill="#5f696d">${metricUnit}</text>
  <path d="M112 618H558" stroke="#255f62" stroke-width="6"/>
  <text x="112" y="682" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="42" font-weight="760" fill="#171716">All-time Codex run</text>
  <text x="112" y="726" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="24" fill="#315f5c">${escapeXml(manifest.period)}</text>
  <g id="signal-stack" transform="translate(700 406)">
    <text x="0" y="-30" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" fill="#315f5c">SIGNAL STACK</text>
    <path d="M0 -12H236" stroke="#ccd6d8" stroke-width="2"/>
    ${signalRows}
  </g>
  <g id="security-glyph" transform="translate(622 558)">
    <g id="holographic-label" clip-path="url(#holoLabelClip)">
      <path id="crypto-frame" d="M0 20L20 0H326L346 20V174L326 194H20L0 174Z" fill="url(#holoSilver)" stroke="#8fa2a6" stroke-width="1.6"/>
      <rect width="346" height="194" fill="url(#holoLattice)" opacity="0.72"/>
      <rect x="0" y="136" width="346" height="22" fill="url(#holoStripe)" opacity="0.9"/>
      <g opacity="0.78">${holoPixels}</g>
      <g id="holo-rosette" transform="translate(92 74)">
        <circle r="72" fill="url(#holoRainbow)" opacity="0.82"/>
        <circle r="49" fill="none" stroke="#ffffff" stroke-width="2.4" opacity="0.58"/>
        <g>${holoRings}</g>
        <circle r="26" fill="url(#holoOrb)" opacity="0.92"/>
        <circle r="8" fill="#ffffff" opacity="0.32"/>
        <path d="M0 -22L19 12H-19Z" fill="#ffffff" opacity="0.34"/>
      </g>
      <circle cx="158" cy="36" r="22" fill="url(#holoOrb)" opacity="0.78"/>
      <circle cx="144" cy="96" r="16" fill="url(#holoOrb)" opacity="0.64"/>
    </g>
    <path d="M0 20L20 0H326L346 20V174L326 194H20L0 174Z" fill="none" stroke="#ffffff" stroke-width="1.1" opacity="0.76"/>
    <path d="M0 20L20 0H326L346 20V174L326 194H20L0 174Z" fill="none" stroke="#1f4d63" stroke-width="1.4" opacity="0.34"/>
    <g id="crypto-checksum-grid" transform="translate(194 20)">
      <rect x="-10" y="-10" width="155" height="155" rx="10" fill="#f8fbfa" opacity="0.96"/>
      <rect x="-10" y="-10" width="155" height="155" rx="10" fill="url(#cryptoMicrogrid)" opacity="0.32"/>
      ${profileQr}
      <path d="M-10 160H145" stroke="#1f4d63" stroke-width="1" opacity="0.38"/>
      <text x="67.5" y="177" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="760" fill="#1f4d63" opacity="0.74">PROFILE URL</text>
    </g>
    <g id="crypto-hash-strip" transform="translate(20 172)">
      <text x="0" y="0" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10.5" font-weight="760" fill="#111418" opacity="0.62">MERIT ${digestLabel}</text>
    </g>
    <path d="M20 0V194M326 0V194" stroke="#ffffff" stroke-width="1" opacity="0.45"/>
  </g>
  <g id="metric-dock" transform="translate(112 792)">
    <rect width="856" height="124" rx="18" fill="#ffffff" stroke="#ccd6d8" stroke-width="2"/>
    ${chips}
  </g>
  <text x="112" y="968" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" fill="#5f696d">${escapeXml(manifest.confidenceStrip)}</text>
  <text x="968" y="968" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" fill="#315f5c">MERIT SERIES</text>
</svg>`;
}
