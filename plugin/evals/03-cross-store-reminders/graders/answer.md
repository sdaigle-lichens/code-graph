---
type: llm
focus: last_message
---

PASS if the answer identifies the real interaction points in both directions: the store calls into reminders (addTask calls scheduleReminder and completeTask calls cancelReminder, in src/store/actions.ts, importing from src/reminders/notifications.ts), and reminders call back into the store (notifyOverdue in src/reminders/notifications.ts reads getTasks from src/store/taskStore.ts and calls moveTask from src/store/actions.ts). Files must be correct.
FAIL if the answer names only one direction, assigns functions to the wrong files, or invents files, functions or interactions that do not exist.
