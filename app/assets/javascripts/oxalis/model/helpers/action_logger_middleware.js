// @flow
import _ from "lodash";
import type { Dispatch } from "redux";

const MAX_ACTION_LOG_LENGTH = 250;
let actionLog = [];
const actionBlacklist = [
  "ADD_TO_LAYER",
  "MOVE_FLYCAM",
  "MOVE_FLYCAM_ORTHO",
  "MOVE_PLANE_FLYCAM_ORTHO",
  "PUSH_SAVE_QUEUE",
  "SET_DIRECTION",
  "SET_INPUT_CATCHER_RECT",
  "SET_MOUSE_POSITION",
  "SET_POSITION",
  "SET_ROTATION",
  "SET_TD_CAMERA",
  "SET_VIEWPORT",
  "ZOOM_TD_VIEW",
];

export function getActionLog(): Array<string> {
  return actionLog;
}

export default function actionLoggerMiddleware<A: $Subtype<{ type: $Subtype<string> }>>(): (
  next: Dispatch<A>,
) => Dispatch<A> {
  return (next: Dispatch<A>) => (action: A): A => {
    const isBlackListed = actionBlacklist.includes(action.type);
    if (!isBlackListed) {
      actionLog.push(action.type);
      const overflowCount = Math.max(actionLog.length - MAX_ACTION_LOG_LENGTH, 0);
      actionLog = _.drop(actionLog, overflowCount);
    }
    return next(action);
  };
}
