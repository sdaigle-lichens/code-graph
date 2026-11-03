import { moveTask } from "../store/actions";
import type { ColumnId } from "../store/types";

export interface DragState {
  taskId: string;
  overColumn: ColumnId;
  overIndex: number;
}

// Called when the user drops a card: persists the new column and slot.
export function useDragReorder(onChange: () => void) {
  return function handleDrop(drag: DragState): void {
    moveTask(drag.taskId, drag.overColumn, drag.overIndex);
    onChange();
  };
}
