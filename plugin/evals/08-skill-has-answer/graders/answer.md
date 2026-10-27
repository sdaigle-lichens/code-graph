---
type: llm
focus: last_message
---

PASS if the answer names the isOverdue function in src/reminders/overdue.ts as the place that decides a task is overdue. Mentioning findOverdue (same file) or its use in notifyOverdue (src/reminders/notifications.ts) is fine.
FAIL if the answer names a different file or function as the place the decision is made, or invents files or functions that do not exist.
