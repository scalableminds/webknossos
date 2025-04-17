import _ from "lodash";
import "test/sagas/saga_integration.mock";
import { createBucketResponseFunction, type WebknossosTestContext } from "test/helpers/apiHelpers";
import Store from "oxalis/store";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";
import { OrthoViews } from "oxalis/constants";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import {
  setActiveCellAction,
  addToLayerAction,
  startEditingAction,
  finishEditingAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { Vector3 } from "oxalis/constants";
import { vi } from "vitest";

export async function testLabelingManyBuckets(
  context: WebknossosTestContext,
  saveInbetween: boolean,
) {
  const { api, model, mocks } = context;

  // We set MAXIMUM_BUCKET_COUNT to 150 and then label 199 = 75 (mag1) + 124 (downsampled) buckets in total.
  // In between, we will save the data which allows the buckets of the first batch to be GC'ed.
  // Therefore, saving the buckets of the second batch should not cause any problems.
  const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
  const cube = model.getCubeByLayerName(volumeTracingLayerName);
  cube.BUCKET_COUNT_SOFT_LIMIT = 150;
  const oldCellId = 11;
  const brushSize = 10;
  const newCellId = 2;

  vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
    createBucketResponseFunction(Uint16Array, oldCellId, 500),
  );

  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await api.data.reloadAllBuckets();

  // Prepare to paint into the center of 50 buckets.
  const paintPositions1 = _.range(0, 50).map(
    (idx) => [32 * idx + 16, 32 * idx + 16, 32 * idx + 16] as Vector3,
  );

  // Prepare to paint into the center of 50 other buckets.
  const paintPositions2 = _.range(50, 100).map(
    (idx) => [32 * idx + 16, 32 * idx + 16, 32 * idx + 16] as Vector3,
  );

  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setToolAction(AnnotationTool.BRUSH));
  Store.dispatch(setActiveCellAction(newCellId));

  for (const paintPosition of paintPositions1) {
    Store.dispatch(setPositionAction(paintPosition));
    Store.dispatch(startEditingAction(paintPosition, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintPosition));
    Store.dispatch(finishEditingAction());
  }

  console.log("saveInbetween", saveInbetween);

  if (saveInbetween) {
    await api.tracing.save();
  }

  for (const paintPosition of paintPositions2) {
    Store.dispatch(setPositionAction(paintPosition));
    Store.dispatch(startEditingAction(paintPosition, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintPosition));
    Store.dispatch(finishEditingAction());
  }

  await api.tracing.save();
}

export default {};
