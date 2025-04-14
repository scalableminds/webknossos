import { put, type ActionPattern } from "redux-saga/effects";
import { takeEvery } from "typed-redux-saga";
import type { Action } from "../actions/actions";
import { select } from "./effect-generators";
import { ToolCollections } from "../accessors/tool_accessor";
import { setToolAction } from "../actions/ui_actions";

function* ensureActiveToolIsInToolkit() {
  const activeToolkit = yield* select((state) => state.userConfiguration.activeToolkit);
  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  const availableTools = ToolCollections[activeToolkit];

  if (!availableTools.includes(activeTool)) {
    yield put(setToolAction(availableTools[0]));
  }
}

// const disabledToolInfo = getDisabledInfoForTools(state);
export default function* toolSaga() {
  yield* takeEvery(
    [
      (action: Action) =>
        action.type === "UPDATE_USER_SETTING" && action.propertyName === "activeToolkit",
    ] as ActionPattern,
    ensureActiveToolIsInToolkit,
  );
}
