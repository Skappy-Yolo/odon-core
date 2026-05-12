---
name: snap
description: Trigger tools/snap.ps1 to capture a screenshot of the current screen. Use at content-worthy moments during development (test going green, deploy succeeding, first end-to-end flow landing, a UI moment worth sharing).
---

When invoked, run the screenshot capture script:

```
powershell -ExecutionPolicy Bypass -File ./tools/snap.ps1 -Label "<short-label>"
```

Pick a short kebab-case label that describes the moment. Examples: `first-test-green`, `oauth-success`, `telegram-hello`, `overlap-detected`.

If the user passes a label via the skill argument, use that. Otherwise infer one from the recent context.

Use `-Window` instead of (or in addition to) `-Label` if only the active window is worth capturing, not the full virtual screen.

The script saves to `screenshots/YYYY-MM-DD_HH-MM-SS_<label>.png`. The screenshots/ directory is gitignored. Report the saved path back to the user so they can find it later for content.

Do NOT take screenshots without a good reason. The point is to capture moments worth showing in a thread or post, not to log every step.
