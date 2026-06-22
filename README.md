# Codex Work Badge

Codex Work Badge is a local-only macOS app that scans a user-selected Codex
root, aggregates usage metadata, and exports a square merit-token PNG for
sharing.

It is designed around a strict privacy boundary:

- no cloud backend;
- no telemetry;
- no social API posting;
- no prompt or response export;
- no global home-directory scan;
- no local path, thread id, email, secret, token, or exact timestamp in the
  public badge manifest.

## What It Generates

- A live dashboard for Codex usage metrics.
- A 1:1 merit-token card preview.
- A 4096x4096 PNG export.
- A scannable profile QR code.
- A local-only Mac utility flow with native Save and Copy actions in the Tauri app.

## Requirements

- macOS for the desktop app and DMG build.
- Node.js 22 or newer.
- Rust/Cargo for Tauri packaging.

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Verification

```bash
npm run doctor
npm run test
npm run qa
npm run build
```

For browser interaction QA, start Chrome with remote debugging:

```bash
open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir=/tmp/codex-work-badge-chrome http://127.0.0.1:5173
CODEX_BADGE_CDP=http://127.0.0.1:9223 npm run browser-qa
```

## Build The Mac App

```bash
npm run dmg
```

The DMG is unsigned and not notarized. Apple Developer ID signing and
notarization are intentionally separate distribution steps.

## Privacy Model

The native scanner reads only the Codex root selected by the user. It parses
`sqlite/state_5.sqlite` and rollout JSONL paths referenced by that database,
then aggregates counts and durations. The public badge is produced from a
restricted manifest, not raw transcripts.

Manual outcome counts, such as resolved bugs or shipped artifacts, must come
from a verified public-safe ledger. They are never inferred from transcripts.

## Status

The included QA docs track the current behavior in
`docs/qa/codex-work-badge-user-stories.csv`.
