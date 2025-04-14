import { fork, put, take, type ActionPattern } from "redux-saga/effects";
import { call, takeEvery } from "typed-redux-saga";
import type { Action } from "../actions/actions";
import { select } from "./effect-generators";
import { AnnotationTool, Toolkits } from "../accessors/tool_accessor";
import { setToolAction } from "../actions/ui_actions";
import { getDisabledInfoForTools } from "../accessors/disabled_tool_accessor";
import { ensureWkReady } from "./ready_sagas";

function* ensureActiveToolIsInToolkit() {
  const activeToolkit = yield* select((state) => state.userConfiguration.activeToolkit);
  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  const availableTools = Toolkits[activeToolkit];

  if (!availableTools.includes(activeTool)) {
    yield put(setToolAction(availableTools[0]));
  }
}

function* switchAwayFromDisabledTool() {
  // This saga ensures that if the current tool becomes disabled,
  // another tool is automatically selected. Should the old tool
  // become available again (without the user having switched
  // to another tool), the old tool will be re-activated.
  let lastForcefullyDisabledTool: AnnotationTool | null = null;

  let disabledInfosForTools = yield* select(getDisabledInfoForTools);
  let activeTool = yield* select((state) => state.uiInformation.activeTool);
  while (true) {
    // Ensure that no volume-tool is selected when being in merger mode.
    // Even though the volume toolbar is disabled, the user can still cycle through
    // the tools via the w shortcut. In that case, the effect-hook is re-executed
    // and the tool is switched to MOVE.
    const disabledInfoForCurrentTool = disabledInfosForTools[activeTool.id];
    const isLastForcefullyDisabledToolAvailable =
      lastForcefullyDisabledTool != null &&
      !disabledInfosForTools[lastForcefullyDisabledTool.id].isDisabled;

    if (disabledInfoForCurrentTool.isDisabled) {
      lastForcefullyDisabledTool = activeTool;
      yield put(setToolAction(AnnotationTool.MOVE));
    } else if (
      lastForcefullyDisabledTool != null &&
      isLastForcefullyDisabledToolAvailable &&
      activeTool === AnnotationTool.MOVE
    ) {
      // Re-enable the tool that was disabled before.
      yield put(setToolAction(lastForcefullyDisabledTool));
      lastForcefullyDisabledTool = null;
    } else if (activeTool !== AnnotationTool.MOVE) {
      // Forget the last disabled tool as another tool besides the move tool was selected.
      lastForcefullyDisabledTool = null;
    }

    // Listen to actions and wait until the getDisabledInfoForTools return value changed
    let continueWaiting = true;
    while (continueWaiting) {
      yield take();
      const newActiveTool = yield* select((state) => state.uiInformation.activeTool);
      if (newActiveTool !== activeTool) {
        activeTool = newActiveTool;
        continueWaiting = false;
      }
      const newDisabledInfosForTools = yield* select(getDisabledInfoForTools);
      if (newDisabledInfosForTools !== disabledInfosForTools) {
        disabledInfosForTools = newDisabledInfosForTools;
        continueWaiting = false;
      }
    }
  }
}

export default function* toolSaga() {
  yield* call(ensureWkReady);
  yield* takeEvery(
    [
      (action: Action) =>
        action.type === "UPDATE_USER_SETTING" && action.propertyName === "activeToolkit",
    ] as ActionPattern,
    ensureActiveToolIsInToolkit,
  );
  yield fork(switchAwayFromDisabledTool);
}
