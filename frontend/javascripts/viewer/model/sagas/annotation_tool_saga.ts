import { call, put, take } from "typed-redux-saga";
import { getToolControllerForAnnotationTool } from "viewer/controller/combinations/tool_controls";
import getSceneController from "viewer/controller/scene_controller_provider";
import { AnnotationTool, MeasurementTools, Toolkit } from "viewer/model/accessors/tool_accessor";
import {
  type CycleToolAction,
  type SetToolAction,
  hideMeasurementTooltipAction,
  setIsMeasuringAction,
} from "viewer/model/actions/ui_actions";
import { getNextTool } from "viewer/model/reducers/reducer_helpers";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { ensureWkReady } from "./ready_sagas";

import { type ActionPattern, delay, fork } from "redux-saga/effects";
import { takeEvery } from "typed-redux-saga";
import { getDisabledInfoForTools } from "../accessors/disabled_tool_accessor";
import { Toolkits } from "../accessors/tool_accessor";
import type { Action } from "../actions/actions";
import { updateUserSettingAction } from "../actions/settings_actions";
import { setToolAction } from "../actions/ui_actions";

function* ensureActiveToolIsInToolkit() {
  const activeToolkit = yield* select((state) => state.userConfiguration.activeToolkit);
  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  const availableTools = Toolkits[activeToolkit];

  if (!availableTools.includes(activeTool)) {
    yield put(setToolAction(availableTools[0]));
  }
}

function* switchAwayFromDisabledTool(): Saga<never> {
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
      // Debounce so that we don't process ALL actions.
      yield delay(50);
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

export function* watchToolDeselection(): Saga<never> {
  let previousTool = yield* select((state) => state.uiInformation.activeTool);

  while (true) {
    const action = (yield* take(["SET_TOOL", "CYCLE_TOOL"]) as any) as
      | SetToolAction
      | CycleToolAction;
    const storeState = yield* select((state) => state);
    let executeDeselect = false;

    if (action.type === "SET_TOOL") {
      executeDeselect = true;
    } else if (getNextTool(storeState) != null) {
      executeDeselect = true;
    }

    if (executeDeselect) {
      getToolControllerForAnnotationTool(previousTool).onToolDeselected();
    }

    previousTool = storeState.uiInformation.activeTool;
  }
}

export function* watchToolReset(): Saga<never> {
  while (true) {
    yield* take("ESCAPE");
    const activeTool = yield* select((state) => state.uiInformation.activeTool);
    if (MeasurementTools.indexOf(activeTool) >= 0) {
      const sceneController = yield* call(getSceneController);
      const geometry =
        activeTool === AnnotationTool.AREA_MEASUREMENT
          ? sceneController.areaMeasurementGeometry
          : sceneController.lineMeasurementGeometry;
      geometry.hide();
      geometry.reset();
      yield* put(hideMeasurementTooltipAction());
      yield* put(setIsMeasuringAction(false));
    }
  }
}

export default function* toolSaga() {
  yield* call(ensureWkReady);

  const isViewMode = yield* select((state) => state.annotation.annotationType === "View");
  if (isViewMode) {
    yield* put(updateUserSettingAction("activeToolkit", Toolkit.ALL_TOOLS));
  }

  yield fork(watchToolDeselection);
  yield fork(watchToolReset);
  yield fork(switchAwayFromDisabledTool);
  yield* takeEvery(
    [
      (action: Action) =>
        action.type === "UPDATE_USER_SETTING" && action.propertyName === "activeToolkit",
    ] as ActionPattern,
    ensureActiveToolIsInToolkit,
  );
}
