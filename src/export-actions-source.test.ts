import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const viteSource = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");

it("prepares PNG exports before enabling download and image-copy actions", () => {
  expect(appSource).toContain("type ExportCache");
  expect(appSource).toContain('state: "ready"');
  expect(appSource).toContain("const exportReady = exportCache.state === \"ready\"");
  expect(appSource).toContain("disabled={isActionPending || !exportReady}");
  expect(appSource).toContain("const EXPORT_SIZE = 4096 as const");
  expect(appSource).toContain('data-testid="codex-root-input"');
  expect(appSource).toContain('data-testid="scan-all-time"');
  expect(appSource).toContain('data-testid="scan-progress"');
  expect(appSource).toContain('data-testid="save-png"');
  expect(appSource).toContain('data-testid="copy-image"');
  expect(appSource).toContain("onKeyDown={preCopyImageFromKeyboard}");
  expect(appSource).not.toContain('data-testid="copy-caption"');
});

it("tries real local save paths before falling back to a download anchor", () => {
  const appendIndex = appSource.indexOf("document.body.appendChild(link)");
  const clickIndex = appSource.indexOf("link.click()");
  expect(appendIndex).toBeGreaterThan(0);
  expect(clickIndex).toBeGreaterThan(appendIndex);
  expect(appSource).toContain("saveWithBrowserFilePicker");
  expect(appSource).toContain("showSaveFilePicker");
  expect(appSource).toContain("save_png_with_panel");
  expect(appSource).toContain("open_png_file");
  expect(appSource).toContain('data-testid="download-png-link"');
  expect(appSource).toContain('data-testid="open-png-link"');
  expect(appSource).not.toContain("Reveal in Finder");
});

it("uses bounded PNG rendering, social QR input, and the same Vite port as the preview browser", () => {
  expect(appSource).toContain("PNG_RENDER_TIMEOUT_MS");
  expect(appSource).toContain("withTimeout(");
  expect(appSource).toContain('data-testid="share-url-input"');
  expect(appSource).toContain("normalizeShareUrl");
  expect(viteSource).toContain("port: 5173");
  expect(viteSource).toContain("strictPort: true");
});
