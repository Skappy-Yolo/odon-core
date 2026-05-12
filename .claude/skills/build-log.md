---
name: build-log
description: Append a new dated entry stub to BUILD_LOG.md so the public devlog stays in sync with the work as it happens. Use this skill when you finish a chunk of work that would make a good devlog entry (a milestone, a decision made, something that shipped, something that didn't work).
---

When invoked, append a new entry to `BUILD_LOG.md` at the repo root with this structure:

```
---

## YYYY-MM-DD — <one-line title>

<a few paragraphs in narrative voice — what changed, what didn't work, what's next>

— Emmanuel
```

Guidelines for writing the entry:
- Voice: first person, narrative, like a Product Manager telling a friend what happened today. Not corporate. Not AI-slop. No em-dashes for emphasis; use commas and periods.
- Include the messy middle: dead ends, things that didn't work, why a decision was hard. That is what makes a devlog readable.
- Reference filenames or features by name. Concrete beats abstract.
- Reference screenshot filenames from `screenshots/` if relevant (e.g. "see `2026-05-12_telegram-first-message.png`").
- Sign each entry with "— Emmanuel".
- Use today's date (the runtime currentDate from the conversation context, not training cutoff).
- Insert the new entry at the TOP of the existing entries (just below the page intro), so the most recent entry is at the top.
- Keep it terse. 2 to 5 short paragraphs.

The whole point of this skill is to remove the friction of opening the file and writing something. The entry doesn't have to be perfect, it has to exist.

Do not invent work that didn't happen. Only summarize work that has actually been completed in the current session or that the user has just described.
