# Codex Work Badge Build Gate State

Updated: 2026-06-21 21:23 America/Toronto
Status: `ready`

## Last Run

- Canonical user-story audit passed: 30 passed, 0 needs_fix, 0 blocked_external, 0 not_verified.
- `CODEX_BADGE_CDP=http://127.0.0.1:9223 npm run codex-badge:user-stories` passed with doctor, unit, visual, typecheck, build, native Cargo check, DMG preflight, DMG build and browser interaction QA.
- Browser QA proved Scan all-time, custom QR URL, 4096x4096 Save as PNG, `image/png` Copy Image, blocked fallbacks and no horizontal overflow.
- DMG generated at `src-tauri/target/release/bundle/dmg/Codex Work Badge_0.1.0_aarch64.dmg`.
- `hdiutil verify` reports the generated DMG checksum as valid.

## In Progress

- Apple Developer ID signing/notarization remains a separate approval-gated distribution tranche.

## Blocked

- Public distribution signing/notarization is blocked until Apple Developer credentials are approved separately.

## Try Next

- Run `npm run codex-badge:doctor`.
- Run `npm run codex-badge:test`.
- Run `npm run codex-badge:qa`.
- Run `CODEX_BADGE_CDP=http://127.0.0.1:9223 npm run codex-badge:browser-qa` when Chrome/CDP is available.
- Run `CODEX_BADGE_CDP=http://127.0.0.1:9223 npm run codex-badge:user-stories` to update the canonical user-story spreadsheet.
- Run `npm run codex-badge:build`.
- Run `npm run codex-badge:dmg`.
