---
name: task-store
description: Task state and the actions that change it (add, move, complete). Read before changing src/store.
allowed-tools: Read
metadata:
  type: concept-skill
  version: "1.0"
---

## When to use

Read this before changing how tasks are stored, ordered or moved between columns.

## Overview

`src/store/taskStore.ts` holds the in-memory task map. `src/store/actions.ts` holds the mutations:
`addTask`, `moveTask` (changes column and position, shifting later tasks in the target column down)
and `completeTask`. Actions call into the reminders concept to schedule and cancel reminders.
