import type { Task } from "oxalis/store";
type SetTaskAction = {
  type: "SET_TASK";
  task: Task | null | undefined;
};
export type TaskAction = SetTaskAction;
export const setTaskAction = (task: Task | null | undefined): SetTaskAction => ({
  type: "SET_TASK",
  task,
});