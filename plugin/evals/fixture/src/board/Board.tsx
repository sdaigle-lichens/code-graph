import { getTasks } from "../store/taskStore";
import type { ColumnId } from "../store/types";
import { Column } from "./Column";
import { useDragReorder } from "./useDragReorder";

const COLUMNS: ColumnId[] = ["backlog", "doing", "done"];

export function Board({ refresh }: { refresh: () => void }) {
  const onDrop = useDragReorder(refresh);
  const tasks = getTasks();
  return (
    <div className="board">
      {COLUMNS.map((id) => (
        <Column key={id} id={id} tasks={tasks.filter((t) => t.column === id)} onDrop={onDrop} />
      ))}
    </div>
  );
}
