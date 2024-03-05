import type { Task } from "oxalis/store";

type SetTaskAction = ReturnType<typeof setTaskAction>;

export type TaskAction = SetTaskAction;

export const setTaskAction = (task: Task | null | undefined) =>
  ({
    type: "SET_TASK",
    task,
  }) as const;
