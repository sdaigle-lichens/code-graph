---
type: llm
focus: last_message
---

PASS if the answer explains that dropping a card on the board calls the useDragReorder handler (src/board/useDragReorder.ts, the handler around line 11-14, which calls moveTask) and that moveTask in src/store/actions.ts (around line 19) updates the task's column and position and shifts the later tasks in the target column down by one. It may also mention the Column component (src/board/Column.tsx) firing the drop from onDragEnd, and Board (src/board/Board.tsx) wiring the hook. File paths and symbol names should be given, ideally with line numbers close to the real ones.
FAIL if the answer names files, functions or hooks that do not exist in this project (invented symbols), omits both useDragReorder and moveTask, or describes reordering as living somewhere else.
