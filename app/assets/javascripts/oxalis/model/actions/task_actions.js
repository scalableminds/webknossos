/* eslint-disable import/prefer-default-export */

/**
 * task_actions.js
 * @flow
 */
import type { Task } from "oxalis/store";

type SetTaskAction = { type: "SET_TASK", task: ?Task };
export type TaskAction = SetTaskAction;

export const setTaskAction = (task: ?Task): SetTaskAction => ({
  type: "SET_TASK",
  task,
});
