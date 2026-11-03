import type { ColumnId, Task } from "../store/types";
import type { DragState } from "./useDragReorder";

interface ColumnProps {
  id: ColumnId;
  tasks: Task[];
  onDrop: (drag: DragState) => void;
}

export function Column({ id, tasks, onDrop }: ColumnProps) {
  return (
    <section className="column">
      <h2>{id}</h2>
      {tasks.map((task, index) => (
        <article
          key={task.id}
          draggable
          onDragEnd={() => onDrop({ taskId: task.id, overColumn: id, overIndex: index })}
        >
          {task.title}
        </article>
      ))}
    </section>
  );
}
