import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { take, call, put } from "typed-redux-saga";
import {
  type SetToolAction,
  type CycleToolAction,
  hideMeasurementTooltipAction,
  setIsMeasuringAction,
} from "oxalis/model/actions/ui_actions";
import { getNextTool } from "oxalis/model/reducers/reducer_helpers";
import { getToolClassForAnnotationTool } from "oxalis/controller/combinations/tool_controls";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { AnnotationToolEnum, MeasurementTools } from "oxalis/constants";
export function* watchToolDeselection(): Saga<void> {
  yield* take("WK_READY");
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
      getToolClassForAnnotationTool(previousTool).onToolDeselected();
    }

    previousTool = storeState.uiInformation.activeTool;
  }
}

export function* watchToolReset(): Saga<void> {
  while (true) {
    yield* take("ESCAPE");
    const activeTool = yield* select((state) => state.uiInformation.activeTool);
    if (MeasurementTools.indexOf(activeTool) >= 0) {
      const sceneController = yield* call(() => getSceneController());
      const geometry =
        activeTool === AnnotationToolEnum.AREA_MEASUREMENT
          ? sceneController.areaMeasurementGeometry
          : sceneController.lineMeasurementGeometry;
      geometry.hide();
      geometry.reset();
      yield* put(hideMeasurementTooltipAction());
      yield* put(setIsMeasuringAction(false));
    }
  }
}
