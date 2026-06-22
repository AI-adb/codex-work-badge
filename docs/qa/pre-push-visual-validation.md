# Pre-Push Visual Validation

Codex Work Badge is a visual product. Before pushing layout, badge, export, or README hero changes, run the local validation gate and get a human visual pass on the generated preview.

## Decision Record

- decision: no public push for visual/layout changes before automated validation and human visual pass;
- project: Codex Work Badge;
- date: 2026-06-22;
- why: small layout defects reached the public repo after automated checks passed but before human visual validation;
- conditions: applies to badge SVG, dashboard layout, export actions, README hero, and any public-facing visual surface;
- invalidators: emergency security/privacy fix with no visual surface, or explicit same-turn approval to bypass;
- status: active.

Required local gate:

```bash
npm run prepush:validate
```

This gate covers privacy doctor, unit tests, typecheck, Vite build, PNG export QA, and browser action QA. It intentionally does not push.

Human validation requirement:

- inspect the exported badge at `artifacts/codex-work-badge/codex-work-badge-qa-1080.png`;
- inspect the browser screenshot at `artifacts/codex-work-badge/browser-qa/browser-actions-desktop.png`;
- do not push if there is clipped text, decorative noise, QR overlap, action-panel overflow, or visible layout collision.
