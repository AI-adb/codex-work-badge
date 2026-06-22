import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createBadgeManifest, DEFAULT_SHARE_URL, renderBadgeSvg } from "./core/badge";
import { findForbiddenPublicData } from "./core/privacy";
import { sampleAggregate, sampleOutcomes, zeroAggregate } from "./core/sample";
import type { BadgeManifest, CodexAggregate } from "./core/types";

type ScanState = "idle" | "scanning" | "success" | "partial" | "error";
type ExportSize = 4096;
type PngExport = { blob: Blob; dataUrl: string; name: string; size: ExportSize; url: string; savedPath?: string };
type ExportCache =
  | { state: "building"; files: null; message: string }
  | { state: "ready"; files: Record<ExportSize, PngExport>; message: string }
  | { state: "error"; files: null; message: string };
type LastExport = PngExport | null;
type ExportAction = "idle" | "save-png" | "copy-image";
type ActionStatus = { action: ExportAction; state: "idle" | "pending" | "success" | "error"; message: string };
type BrowserSaveFilePicker = (options: {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
type CodexBadgeWindow = Window & typeof globalThis & {
  __TAURI_INTERNALS__?: unknown;
  showSaveFilePicker?: BrowserSaveFilePicker;
};

const SCAN_STEPS = ["Index sessions", "Read activity", "Build profile", "Render card"];
const PNG_RENDER_TIMEOUT_MS = 8000;
const EXPORT_SIZE = 4096 as const;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function svgToPngBlob(svg: string, size: number): Promise<Blob> {
  const image = new Image();
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("SVG image decode failed."));
        image.src = url;
      }),
      PNG_RENDER_TIMEOUT_MS,
      "SVG image decode"
    );
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas export is unavailable.");
    context.drawImage(image, 0, 0, size, size);
    return await withTimeout(
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("PNG export failed."))), "image/png");
      }),
      PNG_RENDER_TIMEOUT_MS,
      "Canvas PNG export"
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function defaultRoot() {
  return `${"/Users"}/<you>/.codex`;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en", { notation: value >= 100000 ? "compact" : "standard" }).format(value);
}

function formatHours(minutes: number) {
  const hours = Math.max(0, minutes / 60);
  return hours >= 10 ? Math.round(hours).toString() : hours.toFixed(1);
}

function exportName(size: ExportSize) {
  return `codex-merit-token-${new Date().toISOString().slice(0, 10)}-${size}.png`;
}

function normalizeShareUrl(value: string): string {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("@")
    ? `https://x.com/${trimmed.slice(1)}`
    : /^https?:\/\//i.test(trimmed)
      ? trimmed
      : trimmed
        ? `https://${trimmed}`
        : DEFAULT_SHARE_URL;

  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return DEFAULT_SHARE_URL;
    url.hash = "";
    const normalized = url.toString();
    if (normalized.length > 96 || findForbiddenPublicData(normalized).length > 0) return DEFAULT_SHARE_URL;
    return normalized;
  } catch {
    return DEFAULT_SHARE_URL;
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Image fallback encoding failed."));
    reader.readAsDataURL(blob);
  });
}

async function blobToByteArray(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

function triggerBrowserDownload(file: PngExport): void {
  const link = document.createElement("a");
  link.href = file.url;
  link.download = file.name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => link.remove(), 0);
}

function isKeyboardActivation(event: KeyboardEvent<HTMLButtonElement>): boolean {
  return event.key === "Enter" || event.key === " ";
}

function copySelectionFallback(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection) return false;

  const previousRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);

  try {
    return document.execCommand("copy");
  } finally {
    selection.removeAllRanges();
    if (previousRange) selection.addRange(previousRange);
  }
}

function copyEventFallback(writeData: (data: DataTransfer) => void): boolean {
  let copied = false;
  const handler = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    writeData(event.clipboardData);
    event.preventDefault();
    copied = true;
  };

  document.addEventListener("copy", handler);
  try {
    return document.execCommand("copy") && copied;
  } finally {
    document.removeEventListener("copy", handler);
  }
}

function copyRichImageFallback(dataUrl: string): boolean {
  const richImageHtml = `<img src="${dataUrl}" alt="Codex merit card" />`;
  if (copyEventFallback((data) => {
    data.setData("text/html", richImageHtml);
    data.setData("text/plain", "Codex merit card PNG");
  })) return true;

  const container = document.createElement("div");
  container.contentEditable = "true";
  container.setAttribute("aria-hidden", "true");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.innerHTML = richImageHtml;
  document.body.appendChild(container);
  container.focus();

  try {
    return copySelectionFallback(container);
  } finally {
    container.remove();
  }
}

async function saveWithBrowserFilePicker(file: PngExport): Promise<boolean> {
  const saveFilePicker = (window as CodexBadgeWindow).showSaveFilePicker;
  if (!saveFilePicker || !window.isSecureContext) return false;
  const handle = await saveFilePicker({
    suggestedName: file.name,
    types: [{ description: "PNG image", accept: { "image/png": [".png"] } }]
  });
  const writable = await handle.createWritable();
  await writable.write(file.blob);
  await writable.close();
  return true;
}

function imageClipboardItem(blob: Blob) {
  return new window.ClipboardItem({
    "image/png": blob
  });
}

async function copyPngToClipboard(blob: Blob, dataUrl?: string): Promise<"clipboard" | "html" | "legacy-html" | "blocked"> {
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([imageClipboardItem(blob)]);
      return "clipboard";
    } catch {
      // Fall through to rich HTML copy for browser previews that deny direct image clipboard writes.
    }
    if (dataUrl) {
      try {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            "text/html": new Blob([`<img src="${dataUrl}" alt="Codex merit card" />`], { type: "text/html" }),
            "text/plain": new Blob(["Codex merit card PNG"], { type: "text/plain" })
          })
        ]);
        return "html";
      } catch {
        // Fall through to the synchronous legacy copy path.
      }
    }
  }

  const fallbackCopied = dataUrl ? copyRichImageFallback(dataUrl) : false;
  return fallbackCopied ? "legacy-html" : "blocked";
}

export function App() {
  const [rootPath, setRootPath] = useState(defaultRoot());
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanProgress, setScanProgress] = useState(0);
  const [aggregate, setAggregate] = useState<CodexAggregate>(zeroAggregate);
  const [manifest, setManifest] = useState<BadgeManifest>(() => createBadgeManifest(zeroAggregate, []));
  const [lastExport, setLastExport] = useState<LastExport>(null);
  const [shareUrl, setShareUrl] = useState(DEFAULT_SHARE_URL);
  const [exportCache, setExportCache] = useState<ExportCache>({ state: "building", files: null, message: "Preparing PNG export cache..." });
  const [actionStatus, setActionStatus] = useState<ActionStatus>({ action: "idle", state: "idle", message: "" });
  const [message, setMessage] = useState("No scan yet. Browser preview starts at zero; the Mac app scans the selected Codex root.");
  const actionRun = useRef(0);
  const svg = renderBadgeSvg(manifest, 1080);
  const preCopyImageResult = useRef<Promise<"clipboard" | "html" | "legacy-html" | "blocked"> | null>(null);
  const isTauri = typeof window !== "undefined" && Boolean((window as CodexBadgeWindow).__TAURI_INTERNALS__);
  const exportReady = exportCache.state === "ready";
  const totalMessages = aggregate.userMessages + aggregate.assistantMessages;
  const hours = formatHours(aggregate.activeMinutesEstimate);
  const toolLeverage = aggregate.sessions > 0 ? (aggregate.toolCalls / aggregate.sessions).toFixed(1) : "0.0";
  const exchangeDepth = aggregate.sessions > 0 ? (totalMessages / aggregate.sessions).toFixed(1) : "0.0";
  const scanLabel = scanState === "scanning" ? SCAN_STEPS[Math.min(SCAN_STEPS.length - 1, Math.floor(scanProgress / 26))] : "Ready";
  const isActionPending = actionStatus.state === "pending";

  const signalRows = useMemo(
    () => [
      { label: "Sessions", value: formatCompact(aggregate.sessions) },
      { label: "Exchanges", value: formatCompact(totalMessages) },
      { label: "Tool runs", value: formatCompact(aggregate.toolCalls) },
      { label: "Hours", value: hours }
    ],
    [aggregate.sessions, aggregate.toolCalls, hours, totalMessages]
  );

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    setLastExport(null);
    setExportCache({ state: "building", files: null, message: "Preparing PNG export cache..." });

    void Promise.all(
      ([EXPORT_SIZE] as const).map(async (size) => {
        const blob = await svgToPngBlob(renderBadgeSvg(manifest, size), size);
        const dataUrl = await blobToDataUrl(blob);
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return [size, { blob, dataUrl, name: exportName(size), size, url }] as const;
      })
    )
      .then((entries) => {
        if (cancelled) {
          objectUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        setExportCache({
          state: "ready",
          files: Object.fromEntries(entries) as Record<ExportSize, PngExport>,
          message: "4K PNG is ready for Save as PNG and Copy Image."
        });
      })
      .catch((error) => {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        if (!cancelled) {
          setExportCache({
            state: "error",
            files: null,
            message: `PNG export cache failed: ${visibleError(error)}`
          });
        }
      });

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [manifest]);

  async function runScanAnimation() {
    for (const progress of [14, 31, 52, 73, 88]) {
      setScanProgress(progress);
      await sleep(150);
    }
  }

  function clearCurrentExport() {
    setLastExport(null);
  }

  function beginAction(action: ExportAction, pendingMessage: string) {
    const runId = actionRun.current + 1;
    actionRun.current = runId;
    setActionStatus({ action, state: "pending", message: pendingMessage });
    clearCurrentExport();
    return runId;
  }

  function isCurrentAction(runId: number) {
    return actionRun.current === runId;
  }

  function finishAction(runId: number, state: ActionStatus["state"], action: ExportAction, actionMessage: string) {
    if (!isCurrentAction(runId)) return;
    setActionStatus({ action, state, message: actionMessage });
    setMessage(actionMessage);
  }

  function visibleError(error: unknown) {
    return error instanceof Error && error.message ? error.message : "Browser action failed.";
  }

  function preCopyImage() {
    if (isTauri) return;
    const cached = exportCache.state === "ready" ? exportCache.files[EXPORT_SIZE] : null;
    preCopyImageResult.current = cached ? copyPngToClipboard(cached.blob, cached.dataUrl) : null;
  }

  function preCopyImageFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (isKeyboardActivation(event)) preCopyImage();
  }

  async function scan() {
    setScanState("scanning");
    setScanProgress(6);
    setMessage("Scanning the all-time Codex activity window and building a merit profile.");

    try {
      const animation = runScanAnimation();
      if (!isTauri) {
        await animation;
        await sleep(220);
        setAggregate(sampleAggregate);
        setManifest(createBadgeManifest(sampleAggregate, sampleOutcomes, "private", normalizeShareUrl(shareUrl)));
        setScanProgress(100);
        setScanState("success");
        setMessage("Browser preview scan complete with demo fixture data. The Mac app scans every thread in the selected root.");
        return;
      }

      const [scanned] = await Promise.all([invoke<CodexAggregate>("scan_codex_root", { root: rootPath }), animation]);
      setAggregate(scanned);
      setManifest(createBadgeManifest(scanned, [], "private", normalizeShareUrl(shareUrl)));
      setScanProgress(100);
      setScanState(scanned.confidence === "verified" ? "success" : "partial");
      setMessage(scanned.confidence === "verified" ? "All-time merit profile ready." : "Partial all-time profile ready; review source counts before export.");
    } catch (error) {
      setScanProgress(0);
      setScanState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function updateShareUrl(value: string) {
    setShareUrl(value);
    setManifest((current) => ({ ...current, shareUrl: normalizeShareUrl(value) }));
  }

  async function savePng() {
    const runId = beginAction("save-png", "Preparing 4K PNG...");

    try {
      if (exportCache.state !== "ready") {
        finishAction(runId, "error", "save-png", exportCache.message);
        return;
      }

      const file = exportCache.files[EXPORT_SIZE];
      if (isTauri) {
        const savedPath = await invoke<string>("save_png_with_panel", { png: await blobToByteArray(file.blob), name: file.name });
        setLastExport({ ...file, savedPath });
        finishAction(runId, "success", "save-png", `4K PNG saved to ${savedPath}.`);
        return;
      }

      const savedWithPicker = await saveWithBrowserFilePicker(file);
      if (savedWithPicker) {
        setLastExport(null);
        finishAction(runId, "success", "save-png", "4K PNG saved to the selected file.");
        return;
      }

      setLastExport(file);
      triggerBrowserDownload(file);
      finishAction(runId, "error", "save-png", "This browser has no save sheet. A browser download was requested and fallback links are below; the Mac app uses a native save sheet.");
    } catch (error) {
      finishAction(runId, "error", "save-png", `PNG generation failed: ${visibleError(error)}`);
    }
  }

  async function copyImage() {
    const runId = beginAction("copy-image", "Preparing image clipboard...");
    let fallbackReady = false;

    try {
      if (exportCache.state !== "ready") {
        finishAction(runId, "error", "copy-image", exportCache.message);
        return;
      }

      const cached = exportCache.files[EXPORT_SIZE];
      const png = cached.blob;
      const dataUrl = cached.dataUrl;
      if (!isCurrentAction(runId)) return;
      fallbackReady = true;

      if (isTauri) {
        await invoke("copy_png_to_clipboard", { png: await blobToByteArray(png) });
        setLastExport(null);
        finishAction(runId, "success", "copy-image", "4K PNG copied to the macOS clipboard.");
        return;
      }

      const firstMethod = preCopyImageResult.current ? await preCopyImageResult.current : await copyPngToClipboard(png, dataUrl);
      preCopyImageResult.current = null;
      const resolvedMethod = firstMethod === "blocked" ? await copyPngToClipboard(png, dataUrl) : firstMethod;
      if (resolvedMethod !== "clipboard") throw new Error("Direct PNG clipboard is blocked in this browser.");
      setLastExport(null);
      finishAction(runId, "success", "copy-image", "4K PNG copied to the clipboard.");
    } catch (error) {
      if (!isCurrentAction(runId)) return;
      if (fallbackReady) {
        setLastExport(exportCache.state === "ready" ? exportCache.files[EXPORT_SIZE] : null);
        finishAction(runId, "error", "copy-image", `Browser preview blocked direct PNG clipboard access: ${visibleError(error)} The Mac app copies natively; a PNG fallback is below.`);
      } else {
        finishAction(runId, "error", "copy-image", `Image generation failed: ${visibleError(error)}`);
      }
    }
  }

  async function openSavedPng(path: string) {
    try {
      await invoke("open_png_file", { path });
      setMessage("Saved PNG opened in Preview.");
    } catch (error) {
      setMessage(`Could not open saved PNG in Preview: ${visibleError(error)}`);
    }
  }

  return (
    <main className="app-shell">
      <header className="command-strip">
        <div>
          <span className="eyebrow">Codex Merit Studio</span>
          <strong>Build a shareable all-time merit card</strong>
        </div>
        <div className="strip-signals" aria-label="Current scan status">
            <span className={`status-light ${scanState}`} />
            <span>{scanState === "idle" ? "standby" : scanState}</span>
            <span>{aggregate.confidence} confidence</span>
            <span>{manifest.period}</span>
        </div>
      </header>

      <section className="workbench" aria-label="Codex Work Badge dashboard">
        <aside className="control-panel">
          <div className="panel-header">
            <span>Source</span>
            <strong>Local scan</strong>
          </div>
          <p>Loads the full Codex usage window available in the selected root: first thread to latest thread, metadata only.</p>
          <label>
            Codex root
            <input value={rootPath} onChange={(event) => setRootPath(event.target.value)} aria-label="Selected Codex root" data-testid="codex-root-input" />
          </label>
          <button className="scan-button" type="button" onClick={scan} disabled={scanState === "scanning"} data-testid="scan-all-time">
            <span>{scanState === "scanning" ? "Scanning" : "Scan all-time"}</span>
            <span className="button-pulse" />
          </button>
          <div className="scan-module" data-state={scanState} data-testid="scan-module">
            <div className="scan-copy">
              <span>{scanLabel}</span>
              <strong data-testid="scan-progress">{scanProgress}%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${scanProgress}%` }} />
            </div>
            <div className="scan-grid" aria-hidden="true">
              {SCAN_STEPS.map((step, index) => (
                <i key={step} className={scanProgress >= (index + 1) * 24 ? "active" : ""} />
              ))}
            </div>
          </div>
          <div className="signal-list">
            {signalRows.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </aside>

        <section className="badge-stage" aria-label={manifest.altText}>
          <div className="stage-header">
            <span>Export preview</span>
            <strong>Merit Card</strong>
          </div>
          <div className={`token-frame ${scanState === "scanning" ? "is-scanning" : ""}`} dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="stage-footer">
            <span>4K PNG</span>
            <span>All-time profile</span>
            <span>Share card</span>
          </div>
        </section>

        <aside className="control-panel export-panel">
          <div className="panel-header">
            <span>Output</span>
            <strong>Share asset</strong>
          </div>
          <p>{manifest.caption}</p>
          <label className="share-url-field">
            Profile URL in QR
            <input
              value={shareUrl}
              onChange={(event) => updateShareUrl(event.target.value)}
              placeholder="https://x.com/yourhandle"
              aria-label="Profile URL encoded in badge QR code"
              data-testid="share-url-input"
            />
          </label>
          <div className="profile-card">
            <span>Profile</span>
            <strong>{manifest.profileName}</strong>
            <em>{manifest.profileSubtitle}</em>
          </div>
          <div className="detail-list">
            <span><strong>{hours}</strong> verified hours</span>
            <span><strong>{toolLeverage}</strong> tool runs / session</span>
            <span><strong>{exchangeDepth}</strong> exchanges / session</span>
            <span><strong>{totalMessages.toLocaleString("en")}</strong> total exchanges</span>
          </div>
          <div className={`export-cache ${exportCache.state}`} role={exportCache.state === "error" ? "alert" : "status"} aria-live="polite" data-testid="export-cache">
            {exportCache.message}
          </div>
          <div className="export-actions" aria-label="Export actions">
            <button type="button" onClick={savePng} disabled={isActionPending || !exportReady} data-testid="save-png">
              {actionStatus.action === "save-png" && isActionPending ? "Preparing..." : exportReady ? "Save as PNG" : "Preparing 4K PNG"}
            </button>
            <button
              type="button"
              onPointerDown={preCopyImage}
              onKeyDown={preCopyImageFromKeyboard}
              onClick={copyImage}
              disabled={isActionPending || !exportReady}
              data-testid="copy-image"
            >
              {actionStatus.action === "copy-image" && isActionPending ? "Preparing..." : exportReady ? "Copy Image" : "Preparing Image Copy"}
            </button>
          </div>
          {actionStatus.message ? (
            <div className={`action-message ${actionStatus.state}`} role={actionStatus.state === "error" ? "alert" : "status"} aria-live="polite" data-testid="action-message">
              {actionStatus.message}
            </div>
          ) : null}
          {lastExport ? (
            <div className="export-result" data-testid="export-result">
              <img src={lastExport.url} alt="Generated Codex merit card preview" />
              <div className="export-links">
                <a className="export-ready" href={lastExport.url} download={lastExport.name} data-testid="download-png-link">
                  Download 4K PNG
                </a>
                {isTauri && lastExport.savedPath ? (
                  <button type="button" className="export-ready secondary" onClick={() => openSavedPng(lastExport.savedPath || "")} data-testid="open-png-link">
                    Open in Preview
                  </button>
                ) : (
                  <a className="export-ready secondary" href={lastExport.url} target="_blank" rel="noreferrer" data-testid="open-png-link">
                    Open PNG
                  </a>
                )}
              </div>
            </div>
          ) : null}
        </aside>
      </section>

      <section className="proof-panel" aria-label="Source run log">
        <strong>Run log</strong>
        <span>Threads {aggregate.sourceCounts.threads}</span>
        <span>Rollouts {aggregate.sourceCounts.rolloutsRead}</span>
        <span>Missing {aggregate.sourceCounts.missingRollouts}</span>
        <span>Out of scope {aggregate.sourceCounts.skippedOutOfScope}</span>
        <span>{message}</span>
      </section>
    </main>
  );
}
