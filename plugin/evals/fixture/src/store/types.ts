export type ColumnId = "backlog" | "doing" | "done";

export interface Task {
  id: string;
  title: string;
  column: ColumnId;
  position: number;
  dueAt: number | null;
  completed: boolean;
}
