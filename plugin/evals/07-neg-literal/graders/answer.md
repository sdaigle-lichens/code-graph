---
type: llm
focus: last_message
---

PASS if the answer lists exactly these three TODO comments at these locations: src/store/actions.ts (completeTask, about archiving completed tasks after 30 days, around line 38), src/reminders/overdue.ts (findOverdue, about treating a task due later today as overdue only after 18:00, around line 10), and src/reminders/notifications.ts (notifyOverdue, about batching notifications into one digest message, around line 23). Line numbers may be approximate. The comment text may be paraphrased or reworded, as long as it means the same thing as the original; do not require an exact quote.
FAIL if any of the three locations is missing, or the answer lists a TODO at a file or location that does not exist, or a TODO whose meaning differs from the three above.
