---
type: llm
focus: last_message
---

PASS if the answer points to the isOverdue function in src/reminders/overdue.ts (around line 4-7; a task is overdue when it has a due date in the past and is not completed). Mentioning findOverdue (same file) or its use in notifyOverdue (src/reminders/notifications.ts) is fine.
FAIL if the answer names a different file or function as the place the decision is made, or invents files or functions that do not exist.
