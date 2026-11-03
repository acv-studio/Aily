# Nine-step onboarding evidence

## Revisions and capture conditions

- **Before:** `6fc3f97dc54ca9885bf767e43cd0ee754e3470f9` (`main` baseline).
- **After:** `agent/onboarding-nine-steps-cb9dd3524e27`; the PR description pins the exact implementation commit containing these captures.
- Actual Vite application, Chromium, **390 × 844**, device scale 1, dark theme, Asia/Shanghai; new browser context / empty IndexedDB, no API Key.
- Both runs: welcome → select **陈奕恒** → “开始我们的故事”. The baseline proceeds directly to home; the new flow instead introduces the selected role.
- Profile comparison: open “我的” after completing onboarding with the same selected role. The baseline has no name fields and shows its hard-coded demo identity; the new flow uses synthetic inputs **小雨 / 阿恒**, long replies, blocked topic **工作**, and adult mode **off**. No private conversation or credential was used.

## Before / After

| Scenario | Before (baseline) | After (implementation) |
| --- | --- | --- |
| Fresh welcome | [Before](<before-welcome.png>) | [After](<after-welcome.png>) |
| Same selected role | [Before](<before-choose.png>) | [After](<after-choose.png>) |
| Immediately after selecting the role | [Before: skips to home](<before-after-selection.png>) | [After: role introduction](<after-after-selection.png>) |
| Profile after onboarding | [Before: fixed demo identity](<before-profile.png>) | [After: saved name and preferences entry](<after-profile.png>) |

Additional actual-app states: [independent adult confirmation](<after-consent.png>), [local naming trial](<after-trial.png>), [editable preferences](<after-editor.png>). These are new states, not purported baseline mockups.

## Verification

[The browser verifier](<../../../scripts/verify-onboarding.mjs>) completes all nine steps, checks adult mode stays off without independent confirmation, sends the explicitly labelled local naming rehearsal, finishes, reloads IndexedDB state, verifies one confirmed first relationship memory and two trial turns, edits the nickname without duplicate turns, and checks no horizontal overflow at **320 × 640**.

```sh
npm ci
npm test
npm run build
# Run the changed app on 4178 before running the browser verifier:
npm run dev -- --host 127.0.0.1 --port 4178 --strictPort
node scripts/verify-onboarding.mjs
# Capture Before against the exact baseline app in a separate worktree/server:
AILY_PHASE=before AILY_URL=http://127.0.0.1:4179/ node scripts/verify-onboarding.mjs
```

## Deliberate scope and limitations

- Nine steps follow product §5.1: value → role → introduction → user name → role nickname → preferences → boundaries (with separate adult age/consent dialog) → naming rehearsal → data disclosure. Optional names/preferences can use defaults; boundaries are never bypassed by an adult switch alone.
- Naming rehearsal is a deterministic, labelled **local preview**, not a live model response. Subsequent chat uses the existing provider connection and saved preferences. No paid/live provider request was required to complete onboarding.
- Onboarding notification frequency and allowed times are saved preferences; they do **not** configure the separately existing per-role proactive-message scheduler. UI directs users to “我的 → 角色主动消息设置” for actual opt-in and quiet hours; that existing scheduler runs only while the application is open.
- Adult authorization is self-attested; no identity verification or new content moderation service is introduced. Remote behavior is guided by the existing model's system context.
- First-role nickname is editable; user name, preferences and boundaries apply across roles. Editing preferences does not switch the active role or restore deleted/paused/archived naming memories. Previously onboarded installs can add settings without restarting onboarding.
- Backups retain preferences but reset adult authorization on export/import, requiring fresh consent on the destination device. API Key remains session-only and is excluded from backups.
