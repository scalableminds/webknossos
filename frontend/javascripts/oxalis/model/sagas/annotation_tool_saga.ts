import { AnnotationTool, MeasurementTools } from "oxalis/model/accessors/tool_accessor";
import { getToolControllerForAnnotationTool } from "oxalis/controller/combinations/tool_controls";
import getSceneController from "oxalis/controller/scene_controller_provider";
import {
  type CycleToolAction,
  type SetToolAction,
  hideMeasurementTooltipAction,
  setIsMeasuringAction,
} from "oxalis/model/actions/ui_actions";
import { getNextTool } from "oxalis/model/reducers/reducer_helpers";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { call, put, take } from "typed-redux-saga";
import { ensureWkReady } from "./ready_sagas";

export function* watchToolDeselection(): Saga<never> {
  yield* call(ensureWkReady);
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
      const sceneController = yield* call(() => getSceneController());
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
