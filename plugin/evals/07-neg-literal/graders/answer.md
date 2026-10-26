---
type: llm
focus: last_message
---

PASS if the answer lists exactly these three TODO comments, with files: src/store/actions.ts (completeTask, "also archive completed tasks after 30 days", around line 38), src/reminders/overdue.ts (findOverdue, "treat a task due later today as overdue only after 18:00", around line 10), and src/reminders/notifications.ts (notifyOverdue, "batch notifications into one digest message", around line 23). Line numbers may be approximate.
FAIL if any of the three is missing or the answer lists a TODO that does not exist (invented file or text).
