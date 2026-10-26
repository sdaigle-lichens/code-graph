---
name: board-ui
description: Board and column components plus the drag-and-reorder hook. Read before changing src/board.
allowed-tools: Read
metadata:
  type: concept-skill
  version: "1.0"
---

## When to use

Read this before changing how the board renders or how a dropped card is persisted.

## Overview

`Board` renders three `Column` components. Dropping a card calls the `useDragReorder` handler,
which persists the move through the task store's `moveTask` action.
