# 主角色动态屏保视觉验证

真实应用浏览器截图，不是设计稿或合成基线。

- **Before baseline:** `31ab14f2388315414c781410fc3cedce60d7294a` (current `main`, including nine-step onboarding, stories, voice, safety/privacy and profile data transfer).
- **After:** this ticket branch `agent/character-dynamic-splash-aa3418d8dce7`; the PR description pins the exact reviewed commit.
- **Matched scenario:** isolated fresh browser → complete all nine onboarding steps with 陆听澜 using default names and local trial chat → open 我的 → reload. Baseline reload enters home; changed reload shows the new splash. No seeded personal chat, credentials, API key, or private conversation content.
- **Integration context:** both revisions include the existing voice, safety/privacy and profile data-transfer features. The changed revision integrates the age/AI/data consent into the nine-step welcome before opening the splash or chat; welcome captures show that placement. Baseline images remain real captures of the identified main revision, not a reconstructed mockup.
- **Matched environment:** Chromium, viewport 390×844, device scale 1, dark theme, reduced motion, timezone Asia/Shanghai, controlled browser time 2026-11-03 19:00. Profile captures are full-page and therefore have different image heights because settings add content.

## Before

- [Fresh welcome](./before-welcome.png)
- [Returning to app / home](./before-return.png)
- [Profile](./before-profile.png)

## After

- [Fresh welcome with retained safety consent integrated into nine steps](./after-welcome.png)
- [Returning to app / splash](./after-return.png)
- [Home after skip, same state as baseline home](./after-home.png)
- [Profile with primary/splash settings](./after-profile.png)
- [320×740 static, non-personalized splash / 顾辰泽](./after-return-320.png)
- [320×740 profile settings](./after-settings-320.png)

## Reproduce

```bash
npm run dev -- --host 127.0.0.1 --port 4195 --strictPort
node scripts/verify-character-splash.mjs
# Only on the baseline revision, before implementing the change:
node scripts/verify-character-splash.mjs --before
```

The script checks first completion skips splash, returning shows current local activity, direct character chat, primary/preferences persistence, fixed/static welcome, reduced-motion animation suppression, upward swipe, disabled splash, 15-second automatic entry, 320px no horizontal overflow, and zero browser page errors. Separate React integration tests cover privacy, background return without interrupting chat, refreshed scenes across overnight return, and conservative preference-read fallback.
