import type { Task } from "../store/types";

// A task is overdue when it has a due date in the past and is not completed.
export function isOverdue(task: Task, now: number): boolean {
  if (task.completed || task.dueAt === null) return false;
  return task.dueAt < now;
}

export function findOverdue(tasks: Task[], now: number): Task[] {
  // TODO: treat a task due later today as overdue only after 18:00
  return tasks.filter((task) => isOverdue(task, now));
}
