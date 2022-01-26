// @flow
import _ from "lodash";
import mockRequire from "mock-require";

import "test/sagas/saga_integration.mock";
import { createBucketResponseFunction } from "test/helpers/apiHelpers";
import Store from "oxalis/store";

import { OrthoViews, AnnotationToolEnum } from "oxalis/constants";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";

const { setToolAction } = mockRequire.reRequire("oxalis/model/actions/ui_actions");
const { setPositionAction } = mockRequire.reRequire("oxalis/model/actions/flycam_actions");

const {
  setActiveCellAction,
  addToLayerAction,
  startEditingAction,
  finishEditingAction,
} = mockRequire.reRequire("oxalis/model/actions/volumetracing_actions");

export async function testLabelingManyBuckets(t: any, saveInbetween: boolean) {
  // We set MAXIMUM_BUCKET_COUNT to 150 and then label 199 = 75 (mag1) + 124 (downsampled) buckets in total.
  // In between, we will save the data which allows the buckets of the first batch to be GC'ed.
  // Therefore, saving the buckets of the second batch should not cause any problems.
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  t.context.model.getCubeByLayerName(volumeTracingLayerName).MAXIMUM_BUCKET_COUNT = 150;

  const oldCellId = 11;
  const brushSize = 10;
  const newCellId = 2;

  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();

  // Prepare to paint into the center of 50 buckets.
  const paintPositions1 = _.range(0, 50).map(idx => [32 * idx + 16, 32 * idx + 16, 32 * idx + 16]);
  // Prepare to paint into the center of 50 other buckets.
  const paintPositions2 = _.range(50, 100).map(idx => [
    32 * idx + 16,
    32 * idx + 16,
    32 * idx + 16,
  ]);

  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
  Store.dispatch(setActiveCellAction(newCellId));

  for (const paintPosition of paintPositions1) {
    Store.dispatch(setPositionAction(paintPosition));
    Store.dispatch(startEditingAction(paintPosition, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintPosition));
    Store.dispatch(finishEditingAction());
  }

  console.log("saveInbetween", saveInbetween);
  if (saveInbetween) {
    await t.context.api.tracing.save();
  }

  for (const paintPosition of paintPositions2) {
    Store.dispatch(setPositionAction(paintPosition));
    Store.dispatch(startEditingAction(paintPosition, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintPosition));
    Store.dispatch(finishEditingAction());
  }

  await t.context.api.tracing.save();
}

export default {};
