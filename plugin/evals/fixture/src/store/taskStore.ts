import type { Task } from "./types";

const tasks = new Map<string, Task>();

export function getTasks(): Task[] {
  return [...tasks.values()].sort((a, b) => a.position - b.position);
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function saveTask(task: Task): void {
  tasks.set(task.id, task);
}

export function removeTask(id: string): void {
  tasks.delete(id);
}
