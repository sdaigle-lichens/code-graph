---
type: llm
focus: last_message
---

PASS if the answer explains reordering correctly from the source: dropping a card calls the useDragReorder handler (src/board/useDragReorder.ts) which calls moveTask in src/store/actions.ts, and moveTask updates the task's column and position and shifts later tasks in the target column down. It must not present output of a code graph, graph search or graph query as the basis of the answer.
FAIL if the answer is wrong or invents files or symbols, or says its findings came from a code graph, graph search or graph query.
