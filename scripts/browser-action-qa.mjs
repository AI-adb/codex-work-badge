import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const targetUrl = process.env.CODEX_BADGE_URL || "http://127.0.0.1:5173";
let cdpBase = process.env.CODEX_BADGE_CDP || "http://127.0.0.1:9222";
const artifactDir = path.join(process.cwd(), "artifacts/codex-work-badge/browser-qa");
const expectedDefaultShareUrl = "https://x.com/anthonydibe";
const defaultCdpCandidates = [
  "http://127.0.0.1:9222",
  "http://localhost:9222",
  "http://[::1]:9222",
  "http://127.0.0.1:9223",
  "http://localhost:9223",
  "http://[::1]:9223"
];

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 8000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP websocket error"));
      });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }
    return result.result.value;
  }

  close() {
    this.ws?.close();
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

async function resolveCdpBase() {
  const candidates = Array.from(new Set([cdpBase, ...defaultCdpCandidates].filter(Boolean)));
  const failures = [];

  for (const candidate of candidates) {
    try {
      await fetchJson(`${candidate}/json/version`);
      cdpBase = candidate;
      return candidate;
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(
    `Chrome CDP is not reachable. Start Chrome with: open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/codex-work-badge-chrome ${targetUrl}\n${failures.join("\n")}`
  );
}

async function waitFor(client, expression, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await client.evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function clickSelector(client, selector) {
  const rect = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      disabled: Boolean(element.disabled),
      text: element.innerText || element.textContent || '',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height
    };
  })()`);
  if (!rect) throw new Error(`Missing clickable selector ${selector}`);
  if (rect.disabled) throw new Error(`Selector ${selector} is disabled: ${rect.text}`);
  if (rect.width < 24 || rect.height < 24) throw new Error(`Selector ${selector} is too small`);

  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
}

async function createPage() {
  const target = await fetchJson(`${cdpBase}/json/new?${encodeURIComponent(targetUrl)}`, {
    method: "PUT"
  });
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("DOM.enable");
  await client.send("Log.enable").catch(() => undefined);
  await client.send("Browser.grantPermissions", {
    origin: new URL(targetUrl).origin,
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"]
  }).catch(() => undefined);
  return { client, target };
}

async function closePage(client, target) {
  client.close();
  await fetch(`${cdpBase}/json/close/${target.id}`).catch(() => undefined);
}

async function installSavePickerProbe(client) {
  await client.evaluate(`(() => {
    window.__codexBadgeSavedFiles = [];
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      writable: true,
      value: async (options = {}) => ({
        createWritable: async () => ({
          write: async (blob) => {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const view = new DataView(bytes.buffer);
            window.__codexBadgeSavedFiles.push({
              name: options.suggestedName || '',
              type: blob.type,
              size: blob.size,
              width: view.getUint32(16),
              height: view.getUint32(20)
            });
          },
          close: async () => {
            const last = window.__codexBadgeSavedFiles[window.__codexBadgeSavedFiles.length - 1];
            if (last) last.closed = true;
          }
        })
      })
    });
  })()`);
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  await resolveCdpBase();

  const { client, target } = await createPage();
  const failures = [];

  try {
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await client.send("Page.navigate", { url: targetUrl });
    await waitFor(client, "document.readyState === 'complete' && !!document.querySelector('[data-testid=\"save-png\"]')", "page ready");
    await waitFor(client, "document.querySelector('[data-testid=\"export-cache\"]')?.classList.contains('ready')", "PNG export cache", 16000);
    const initialShare = await client.evaluate(`(() => ({
      input: document.querySelector('[data-testid="share-url-input"]')?.value || '',
      qr: document.querySelector('[data-profile-url]')?.getAttribute('data-profile-url') || ''
    }))()`);
    const initialZero = await client.evaluate(`(() => ({
      noScanMessage: document.body.innerText.includes('No scan yet'),
      progress: document.querySelector('[data-testid="scan-progress"]')?.innerText || '',
      threadsZero: document.body.innerText.includes('Threads 0'),
      sessionsZero: document.body.innerText.includes('Sessions\\n0') || document.body.innerText.includes('Sessions 0')
    }))()`);
    const initialScreenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true
    });
    const initialScreenshotPath = path.join(artifactDir, "browser-initial-zero-desktop.png");
    await writeFile(initialScreenshotPath, Buffer.from(initialScreenshot.data, "base64"));

    await client.evaluate(`(() => {
      const input = document.querySelector('[data-testid="codex-root-input"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '/Users/<qa>/.codex');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const rootInput = await client.evaluate(`(() => document.querySelector('[data-testid="codex-root-input"]')?.value || '')()`);

    await clickSelector(client, "[data-testid='scan-all-time']");
    await waitFor(client, "document.querySelector('[data-testid=\"scan-progress\"]')?.innerText === '100%'", "scan completion");
    await waitFor(client, "document.body.innerText.includes('Browser preview scan complete with demo fixture data')", "scan success message");
    const scanResult = await client.evaluate(`(() => ({
      moduleState: document.querySelector('[data-testid="scan-module"]')?.getAttribute('data-state') || '',
      progress: document.querySelector('[data-testid="scan-progress"]')?.innerText || '',
      message: document.body.innerText.includes('Browser preview scan complete with demo fixture data')
    }))()`);
    await waitFor(client, "document.querySelector('[data-testid=\"export-cache\"]')?.classList.contains('ready')", "PNG export cache after scan", 16000);

    await client.evaluate(`(() => {
      const input = document.querySelector('[data-testid="share-url-input"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'https://x.com/testprofile');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(client, "document.querySelector('[data-profile-url=\"https://x.com/testprofile\"]')", "custom profile QR");
    await waitFor(client, "document.querySelector('[data-testid=\"export-cache\"]')?.classList.contains('ready')", "PNG export cache after URL update", 16000);

    await installSavePickerProbe(client);
    await clickSelector(client, "[data-testid='save-png']");
    await waitFor(client, "document.querySelector('[data-testid=\"action-message\"]')?.innerText.includes('4K PNG saved')", "4K action success");
    const saved4096 = await client.evaluate(`(() => window.__codexBadgeSavedFiles?.[0] || null)()`);

    await clickSelector(client, "[data-testid='copy-image']");
    await waitFor(client, "(() => { const text = document.querySelector('[data-testid=\"action-message\"]')?.innerText || ''; return /copied|blocked direct PNG clipboard/i.test(text); })()", "image copy status");
    await client.send("Page.bringToFront").catch(() => undefined);
    await client.evaluate("window.focus()");
    const imageCopy = await client.evaluate(`(async () => {
      const status = document.querySelector('[data-testid="action-message"]')?.innerText || '';
      const fallbackVisible = !!document.querySelector('[data-testid="download-png-link"]');
      let types = [];
      try {
        const items = await navigator.clipboard.read();
        types = items.flatMap((item) => item.types);
      } catch (error) {
        types = ['READ_FAIL:' + error.message];
      }
      return { status, types, copied: types.includes('image/png'), fallbackVisible };
    })()`);

    const successLayout = await client.evaluate(`(() => ({
      hasDownloadLink: !!document.querySelector('[data-testid="download-png-link"]'),
      hasOpenLink: !!document.querySelector('[data-testid="open-png-link"]'),
      actionText: document.querySelector('[data-testid="action-message"]')?.innerText || ''
    }))()`);

    await client.evaluate(`(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        writable: true,
        value: undefined
      });
    })()`);
    await clickSelector(client, "[data-testid='save-png']");
    await waitFor(client, "document.querySelector('[data-testid=\"action-message\"]')?.innerText.includes('no save sheet')", "save fallback message");
    const fallbackSave = await client.evaluate(`(() => ({
      message: document.querySelector('[data-testid="action-message"]')?.innerText || '',
      hasDownloadLink: !!document.querySelector('[data-testid="download-png-link"]'),
      hasOpenLink: !!document.querySelector('[data-testid="open-png-link"]')
    }))()`);

    await client.evaluate(`(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          write: async () => { throw new Error('blocked by browser-action-qa'); },
          read: async () => []
        }
      });
    })()`);
    await clickSelector(client, "[data-testid='copy-image']");
    await waitFor(client, "document.querySelector('[data-testid=\"action-message\"]')?.innerText.includes('blocked direct PNG clipboard')", "copy fallback message");
    const fallbackCopy = await client.evaluate(`(() => ({
      message: document.querySelector('[data-testid="action-message"]')?.innerText || '',
      hasDownloadLink: !!document.querySelector('[data-testid="download-png-link"]'),
      hasOpenLink: !!document.querySelector('[data-testid="open-png-link"]')
    }))()`);

    const layout = await client.evaluate(`(() => {
      const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
        || document.body.scrollWidth > document.documentElement.clientWidth + 2;
      const badgeSvg = document.querySelector('svg')?.outerHTML || '';
      const readNumber = (pattern) => {
        const match = badgeSvg.match(pattern);
        return match ? Number(match[1]) : null;
      };
      const securityY = readNumber(/id="security-glyph" transform="translate\\(622 (\\d+)\\)"/);
      const activityY = readNumber(/id="activity-rail" transform="translate\\(112 (\\d+)\\)"/);
      const allTimeY = readNumber(/<text x="112" y="(\\d+)"[^>]*font-size="42"[^>]*>All-time Codex run<\\/text>/);
      const hasSignalStack = !!document.querySelector('#signal-stack') || badgeSvg.includes('SIGNAL STACK');
      return {
        overflow,
        cacheText: document.querySelector('[data-testid="export-cache"]')?.innerText || '',
        actionText: document.querySelector('[data-testid="action-message"]')?.innerText || '',
        hasDownloadLink: !!document.querySelector('[data-testid="download-png-link"]'),
        hasOpenLink: !!document.querySelector('[data-testid="open-png-link"]'),
        hasRevealButton: document.body.innerText.includes('Reveal in Finder'),
        hasCopyCaption: document.body.innerText.includes('Copy Caption'),
        hasCustomQr: !!document.querySelector('[data-profile-url="https://x.com/testprofile"]'),
        hasHolographicEdge: !!document.querySelector('#holographic-edge'),
        hasActivityRail: !!document.querySelector('#activity-rail'),
        hasActivityLattice: !!document.querySelector('#activity-lattice'),
        hasSignalStack,
        securityY,
        activityY,
        allTimeY,
        securityBandClear: typeof securityY === 'number' && securityY >= 340 && securityY + 194 < 620,
        allTimeBeforeActivity: typeof allTimeY === 'number' && typeof activityY === 'number' && allTimeY < activityY,
        activityGridWide: badgeSvg.includes('id="activity-lattice" transform="translate(24 144)"') && badgeSvg.includes('width="812" height="55"'),
        hasTopActiveDay: badgeSvg.includes('Top active day'),
        hasDeprecatedCornerAccents: badgeSvg.includes('M74 72H220'),
        hasDeprecatedHeaderRules: badgeSvg.includes('M112 138H404M746 138H968'),
        hasDeprecatedActivityAxis: badgeSvg.includes('>EARLY</text>') || badgeSvg.includes('>MID</text>') || badgeSvg.includes('>RECENT</text>'),
        hasDeprecatedActivityModes: badgeSvg.includes('>WEEKLY</text>') || badgeSvg.includes('>CUMULATIVE</text>'),
        hasExternalQrLabelPosition: badgeSvg.includes('y="177" text-anchor="middle"')
      };
    })()`);

    const metrics = await client.send("Page.getLayoutMetrics");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: Math.ceil(metrics.cssContentSize.height),
      deviceScaleFactor: 1,
      mobile: false
    });
    const screenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true
    });
    const screenshotPath = path.join(artifactDir, "browser-actions-desktop.png");
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

    const runtimeErrors = client.events
      .filter((event) => event.method === "Runtime.exceptionThrown" || event.method === "Log.entryAdded")
      .map((event) => JSON.stringify(event.params));

    if (!saved4096 || saved4096.type !== "image/png" || saved4096.width !== 4096 || saved4096.height !== 4096 || saved4096.size < 1000 || !saved4096.closed) {
      failures.push(`4K save picker did not receive a complete PNG: ${JSON.stringify(saved4096)}`);
    }
    if (initialShare.input !== expectedDefaultShareUrl || initialShare.qr !== expectedDefaultShareUrl) failures.push(`default profile URL is not rendered: ${JSON.stringify(initialShare)}`);
    if (!initialZero.noScanMessage || initialZero.progress !== "0%" || !initialZero.threadsZero || !initialZero.sessionsZero) failures.push(`initial browser preview is not zeroed: ${JSON.stringify(initialZero)}`);
    if (rootInput !== "/Users/<qa>/.codex") failures.push(`Codex root input did not retain edited value: ${rootInput}`);
    if (scanResult.moduleState !== "success" || scanResult.progress !== "100%" || !scanResult.message) failures.push(`scan all-time flow failed: ${JSON.stringify(scanResult)}`);
    if (/copied/i.test(imageCopy.status) && !imageCopy.copied) failures.push(`image copy claimed success but clipboard did not contain image/png: ${JSON.stringify(imageCopy)}`);
    if (!/copied/i.test(imageCopy.status) && !imageCopy.fallbackVisible) failures.push(`image copy did not copy or expose PNG fallback: ${JSON.stringify(imageCopy)}`);
    if (successLayout.hasDownloadLink || successLayout.hasOpenLink) failures.push(`fallback links appeared after successful actions: ${JSON.stringify(successLayout)}`);
    if (!fallbackSave.message.includes("no save sheet") || !fallbackSave.hasDownloadLink || !fallbackSave.hasOpenLink) failures.push(`save fallback did not expose fallback links: ${JSON.stringify(fallbackSave)}`);
    if (!fallbackCopy.message.includes("blocked direct PNG clipboard") || !fallbackCopy.hasDownloadLink || !fallbackCopy.hasOpenLink) failures.push(`copy fallback did not expose fallback links: ${JSON.stringify(fallbackCopy)}`);
    if (layout.overflow) failures.push("desktop horizontal overflow");
    if (!imageCopy.copied && (!layout.hasDownloadLink || !layout.hasOpenLink)) failures.push("download/open fallback links are missing after clipboard fallback");
    if (layout.hasRevealButton) failures.push("disabled Reveal in Finder button is still visible");
    if (layout.hasCopyCaption) failures.push("Copy Caption button is still visible");
    if (!layout.hasCustomQr) failures.push("custom profile URL QR is not rendered");
    if (!layout.hasHolographicEdge) failures.push("holographic edge is not rendered");
    if (!layout.hasActivityRail || !layout.hasActivityLattice) failures.push(`activity rail is not rendered: ${JSON.stringify(layout)}`);
    if (layout.hasSignalStack) failures.push("dense signal stack is still rendered inside the badge SVG");
    if (!layout.securityBandClear) failures.push(`security glyph is not isolated in the metric band: ${JSON.stringify(layout)}`);
    if (!layout.allTimeBeforeActivity || !layout.activityGridWide) failures.push(`activity section is not separated or wide enough: ${JSON.stringify(layout)}`);
    if (layout.hasTopActiveDay) failures.push("ambiguous Top active day metric is still rendered");
    if (layout.hasDeprecatedCornerAccents) failures.push("deprecated corner accent rules are still rendered");
    if (layout.hasDeprecatedHeaderRules) failures.push("deprecated top decorative rules are still rendered");
    if (layout.hasDeprecatedActivityAxis || layout.hasDeprecatedActivityModes) failures.push(`deprecated activity rail micro-labels are still rendered: ${JSON.stringify(layout)}`);
    if (layout.hasExternalQrLabelPosition) failures.push("profile URL label is still positioned outside the QR block");
    if (runtimeErrors.length) failures.push(`runtime errors: ${runtimeErrors.join(" | ")}`);

    const summary = {
      passed: failures.length === 0,
      failures,
      targetUrl,
      cdpBase,
      initialShare,
      initialZero,
      rootInput,
      scanResult,
      saved4096,
      imageCopy,
      successLayout,
      fallbackSave,
      fallbackCopy,
      layout,
      screenshot: screenshotPath,
      initialScreenshot: initialScreenshotPath
    };
    await writeFile(path.join(artifactDir, "browser-action-summary.json"), JSON.stringify(summary, null, 2));

    if (failures.length) {
      console.error(JSON.stringify(summary, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await closePage(client, target);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
