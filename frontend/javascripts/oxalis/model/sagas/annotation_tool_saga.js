// @flow
/* eslint-disable import/prefer-default-export */
import { type Saga, _takeEvery, select } from "oxalis/model/sagas/effect-generators";
import type { SetToolAction, CycleToolAction } from "oxalis/model/actions/ui_actions";
import { getNextTool } from "oxalis/model/reducers/reducer_helpers";
import { getToolClassForAnnotationTool } from "oxalis/controller/combinations/tool_controls";

export function* watchToolDeselection(): Saga<void> {
  function* triggerToolDeselection(action: SetToolAction | CycleToolAction): Saga<void> {
    const storeState = yield* select(state => state);
    let executeDeselect = false;
    if (action.type === "SET_TOOL") {
      executeDeselect = true;
    } else if (getNextTool(storeState) != null) {
      executeDeselect = true;
    }
    if (executeDeselect) {
      getToolClassForAnnotationTool(storeState.uiInformation.activeTool).onToolDeselected();
    }
  }

  yield _takeEvery(["CYCLE_TOOL", "SET_TOOL"], triggerToolDeselection);
}
