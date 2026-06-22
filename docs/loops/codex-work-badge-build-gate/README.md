# Codex Work Badge Build Gate

This loop gates the local Codex Work Badge Mac app. It proves local aggregate
parsing, public badge privacy, deterministic square PNG export, and app build
health. It does not authorize hosted sharing, telemetry, social posting, global
Codex changes, Shopify actions, or Apple notarization.

## Routine Run

```bash
npm run codex-badge:doctor
npm run codex-badge:test
npm run codex-badge:qa
CODEX_BADGE_CDP=http://127.0.0.1:9223 npm run codex-badge:browser-qa
CODEX_BADGE_CDP=http://127.0.0.1:9223 npm run codex-badge:user-stories
npm run codex-badge:build
```

`npm run codex-badge:dmg` is allowed only after Rust/Cargo are installed. Apple
Developer ID signing and notarization are separate approval-gated work.

## Stop Conditions

- Any forbidden public data appears in a badge manifest or QA artifact.
- The parser reads outside the selected Codex root.
- Network or browser persistence APIs appear in the app source.
- PNG export is not exactly square at 1080 and 4096.
- The Rust/Tauri toolchain is missing for DMG packaging.
