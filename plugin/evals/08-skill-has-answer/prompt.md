---
max_turns: 12
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
runs: 3
---

The `reminders` concept skill below is already loaded in this session (eval workspaces do not load
project `.claude/skills`, so it is quoted here instead).

> ## reminders
>
> Overdue detection and reminder notifications.
>
> - `isOverdue(task)` in `src/reminders/overdue.ts` is the single place that decides a task is overdue:
>   it has a due date in the past and is not completed.
> - `findOverdue(tasks)` in the same file filters a list with it.
> - `notifyOverdue` in `src/reminders/notifications.ts` calls `findOverdue`, moves overdue tasks in the
>   task store and sends the message.

Which function decides that a task is overdue, and in which file is it?
