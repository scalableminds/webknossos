/* eslint-disable import/prefer-default-export */
// @ts-expect-error ts-migrate(2305) FIXME: Module '"oxalis/model/sagas/effect-generators"' ha... Remove this comment to see the full error message
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select, take } from "oxalis/model/sagas/effect-generators";
import type { SetToolAction, CycleToolAction } from "oxalis/model/actions/ui_actions";
import { getNextTool } from "oxalis/model/reducers/reducer_helpers";
import { getToolClassForAnnotationTool } from "oxalis/controller/combinations/tool_controls";
export function* watchToolDeselection(): Saga<void> {
  yield* take("WK_READY");
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'state' implicitly has an 'any' type.
  let previousTool = yield* select((state) => state.uiInformation.activeTool);

  while (true) {
    const action = (yield* take(["SET_TOOL", "CYCLE_TOOL"]) as any) as
      | SetToolAction
      | CycleToolAction;
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'state' implicitly has an 'any' type.
    const storeState = yield* select((state) => state);
    let executeDeselect = false;

    if (action.type === "SET_TOOL") {
      executeDeselect = true;
    } else if (getNextTool(storeState) != null) {
      executeDeselect = true;
    }

    if (executeDeselect) {
      getToolClassForAnnotationTool(previousTool).onToolDeselected();
    }

    previousTool = storeState.uiInformation.activeTool;
  }
}
