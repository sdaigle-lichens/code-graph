import { cancelReminder, scheduleReminder } from "../reminders/notifications";
import { getTask, getTasks, saveTask } from "./taskStore";
import type { ColumnId, Task } from "./types";

export function addTask(title: string, dueAt: number | null = null): Task {
  const task: Task = {
    id: `t${getTasks().length + 1}`,
    title,
    column: "backlog",
    position: getTasks().length,
    dueAt,
    completed: false,
  };
  saveTask(task);
  if (dueAt !== null) scheduleReminder(task);
  return task;
}

export function moveTask(id: string, column: ColumnId, position: number): Task {
  const task = getTask(id);
  if (!task) throw new Error(`unknown task ${id}`);
  // Shift the tasks at or after the target slot down by one.
  for (const other of getTasks()) {
    if (other.id !== id && other.column === column && other.position >= position) {
      saveTask({ ...other, position: other.position + 1 });
    }
  }
  const moved = { ...task, column, position };
  saveTask(moved);
  return moved;
}

export function completeTask(id: string): Task {
  const task = getTask(id);
  if (!task) throw new Error(`unknown task ${id}`);
  const done = { ...task, completed: true, column: "done" as ColumnId };
  saveTask(done);
  // TODO: also archive completed tasks after 30 days
  cancelReminder(id);
  return done;
}
