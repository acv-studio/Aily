# Chat actions: real application verification

- Before: application source revision `a353b8c46782bd4168f71e9c1b4fa9e38374f522`.
- After: application source revision `e56bac6637fe4128745a8b107b3a699591fbc879`.
- Both captures use actual Aily in Chromium, a fresh isolated browser context, the same synthetic three-message conversation, 390 × 844 viewport, dark theme, and Asia/Shanghai time zone. No user history or provider credentials are used. The displayed send times reflect the separate capture runs.
- Model responses are intercepted with a deterministic SSE response. Tests inspect the actual outgoing JSON request body; they do not certify live provider availability or semantic response quality.

## Before / After: search

Before, lowercase `coffee` did not match `Coffee on Sunday`; closing via the header icon left the filter active with no visible search field. After, case-insensitive search finds the message, and either close action restores all three rows.

| Before | After |
| --- | --- |
| ![Before search](before-search.png) | ![After search](after-search.png) |

## Before / After: withdrawal of selected quote

Same scenario: quote the first message, send a reply, select it again, then withdraw the source. Before, the unusable selected quote remained in the composer. After, it is cleared; the persisted reply still honestly labels its missing source. The original user message remains a withdrawal tombstone.

| Before | After |
| --- | --- |
| ![Before withdrawal](before-withdraw-quote.png) | ![After withdrawal](after-withdraw-quote.png) |

## Checks

- `npm run build`: TypeScript and production Vite build pass.
- `npm test`: 24 files / 356 tests pass, including 15 chat-action integration cases, five additional ChatPanel action cases and three quote-context cases.
- `BASE_URL=http://127.0.0.1:4197 node scripts/verify-chat-actions.mjs`: real browser checks pass for search, both close actions, quote propagation into intercepted transport, source withdrawal, active quote clearing, search exclusion, reload persistence, subsequent transport exclusion and role isolation; no page errors.
- Integration coverage also verifies temporary-session disk isolation, attachment byte removal, invalid quote targets, protected character messages, stale memory-save rejection and exclusion of associated assistant echoes from subsequent outgoing requests.
- Withdrawal does not erase already transmitted provider data or locally displayed character replies. Other user-written messages containing copied text cannot be automatically redacted.

The existing app baseline had a TypeScript error from missing required onboarding API-key props at its first return. The minimal wiring fix is included to restore production build verification; no onboarding layout was redesigned.
