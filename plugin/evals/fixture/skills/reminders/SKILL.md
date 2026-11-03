---
name: reminders
description: Overdue detection and reminder notifications. Read before changing src/reminders.
allowed-tools: Read
metadata:
  type: concept-skill
  version: "1.0"
---

## When to use

Read this before changing what counts as overdue or how users are notified.

## Overview

`src/reminders/overdue.ts` decides overdue-ness. `src/reminders/notifications.ts` tracks scheduled
reminders and, for overdue tasks, moves them in the task store and sends a message.
