declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    ClipboardItem?: typeof ClipboardItem;
  }
}

export {};
