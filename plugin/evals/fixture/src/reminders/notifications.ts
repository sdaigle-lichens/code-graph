import { moveTask } from "../store/actions";
import { getTasks } from "../store/taskStore";
import type { Task } from "../store/types";
import { findOverdue } from "./overdue";

const scheduled = new Set<string>();

export function scheduleReminder(task: Task): void {
  scheduled.add(task.id);
}

export function cancelReminder(id: string): void {
  scheduled.delete(id);
}

// Pushes every overdue task to the top of the doing column and notifies the user.
export function notifyOverdue(now: number, send: (message: string) => void): number {
  const overdue = findOverdue(getTasks(), now).filter((t) => scheduled.has(t.id));
  for (const task of overdue) {
    moveTask(task.id, "doing", 0);
    send(`Task overdue: ${task.title}`);
  }
  // TODO: batch notifications into one digest message
  return overdue.length;
}
