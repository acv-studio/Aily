# Relationship stage evidence

Baseline: `31ab14f2388315414c781410fc3cedce60d7294a` (unmodified application UI).
Changed revision: the implementation commit carrying this directory; see PR description for exact SHA.

Actual Chromium application captures, not mockups. Synthetic user 小雨; 陆听澜; one onboarding confirmation and eight confirmed shared memories; memory page with all categories, no search. Before and After use 390×844 viewport, dark theme, Asia/Shanghai, reduced motion. Full-page capture heights differ because the new panel adds content. No private conversation data or credentials were used.

- `before-intimate.png`: real baseline memory page, same seeded scenario.
- `after-intimate.png`: same scenario before consenting to a name; stage and shared events, no numerical relationship score.
- `after-saved.png`: per-role nickname saved and restored after reload.
- `after-locked.png`: another role remains 初遇 and cannot set a nickname.
- `after-320.png`: narrow 320×740 viewport with saved nickname; overflow verified.

Reproduce with `npm run dev -- --port 4196 --strictPort`, then `node scripts/verify-relationship.mjs`. Baseline capture uses the original revision and `--before`; do not overwrite baseline from changed UI.

The existing internal stage thresholds are retained. Only currently eligible confirmed memories contribute: no pending, archived, rejected, paused, expired, sensitive or future-dated records; latest duplicate version wins. Memory-policy changes/deletion can change the displayed current state, but elapsed time alone and purchases cannot. Nicknames are independently saved per role, require explicit opt-in and the existing intimacy threshold, and never authorize adult content. Optional backup field `onboardingProfile.exclusiveNames` preserves old backups without migration. No new anniversary/voice entitlement is claimed.
