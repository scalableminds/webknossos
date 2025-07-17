import _ from "lodash";
import type { Dispatch } from "redux";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { Action } from "viewer/model/actions/actions";

const MAX_ACTION_LOG_LENGTH = 250;
let actionLog: string[] = [];

// For grouping consecutive action types
let lastActionName: string | null = null;
let lastActionCount: number = 0;

const actionBlacklist = [
  "ADD_TO_LAYER",
  "MOVE_FLYCAM",
  "MOVE_FLYCAM_ORTHO",
  "MOVE_PLANE_FLYCAM_ORTHO",
  "PUSH_SAVE_QUEUE_TRANSACTION",
  "SET_DIRECTION",
  "SET_INPUT_CATCHER_RECT",
  "SET_MOUSE_POSITION",
  "SET_POSITION",
  "SET_ROTATION",
  "SET_TD_CAMERA",
  "SET_VIEWPORT",
  "ZOOM_TD_VIEW",
  "UPDATE_TEMPORARY_SETTING",
];
export function getActionLog(): Array<string> {
  return actionLog;
}
export default function actionLoggerMiddleware<A extends Action>(): (
  next: Dispatch<A>,
) => Dispatch<A> {
  // @ts-expect-error ts-migrate(2322) FIXME: Type '(next: Dispatch<A>) => (action: A) => A' is ... Remove this comment to see the full error message
  return (next: Dispatch<A>) =>
    (action: A): A => {
      const isBlackListed = actionBlacklist.includes(action.type);

      if (!isBlackListed) {
        if (lastActionName == null || lastActionName !== action.type) {
          actionLog.push(action.type);
          lastActionCount = 1;
        } else {
          lastActionCount++;
          actionLog[actionLog.length - 1] = lastActionName + " * " + lastActionCount;
        }
        lastActionName = action.type;

        const overflowCount = Math.max(actionLog.length - MAX_ACTION_LOG_LENGTH, 0);
        actionLog = _.drop(actionLog, overflowCount);

        if (WkDevFlags.logActions) {
          console.group(action.type);
          console.info("dispatching", action.type);
          let result = next(action);
          // console.log('next state', store.getState())
          console.groupEnd();
          return result;
        }
      }

      return next(action);
    };
}
