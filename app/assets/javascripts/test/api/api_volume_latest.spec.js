/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import "backbone.marionette";
import sinon from "sinon";
import mockRequire from "mock-require";
import Constants from "oxalis/constants";
import { setupOxalis } from "test/helpers/apiHelpers";
import VOLUMETRACING_OBJECT from "../fixtures/volumetracing_object";

// All the mocking is done in the helpers file, so it can be reused for both skeleton and volume API
test.beforeEach(t => setupOxalis(t, "volume"));

test("getActiveCellId should get the id of the active cell", t => {
  const api = t.context.api;
  t.is(api.tracing.getActiveCellId(), VOLUMETRACING_OBJECT.content.contentData.activeCell);
});

test("setActiveCell should set the active cell id", t => {
  const api = t.context.api;
  api.tracing.setActiveCell(27);
  t.is(api.tracing.getActiveCellId(), 27);
});

test("getVolumeMode should get the current mode", t => {
  const api = t.context.api;
  t.is(api.tracing.getVolumeMode(), Constants.VOLUME_MODE_MOVE);
});

test("setVolumeMode should set the current mode", t => {
  const api = t.context.api;
  api.tracing.setVolumeMode(Constants.VOLUME_MODE_TRACE);
  t.is(api.tracing.getVolumeMode(), Constants.VOLUME_MODE_TRACE);
  api.tracing.setVolumeMode(Constants.VOLUME_MODE_MOVE);
  t.is(api.tracing.getVolumeMode(), Constants.VOLUME_MODE_MOVE);
});

test("setVolumeMode should throw an error for an invalid mode", t => {
  const api = t.context.api;
  t.throws(() => api.tracing.setVolumeMode(67));
  t.throws(() => api.tracing.setVolumeMode("myMode"));
  t.throws(() => api.tracing.setVolumeMode());
});

test("Data Api: labelVoxels should label a list of voxels", t => {
  const { api, model } = t.context;
  const cube = model.getSegmentationBinary().cube;
  sinon.stub(model.getSegmentationBinary().layer, "requestFromStoreImpl").returns(new Uint8Array());

  api.data.labelVoxels([[1, 2, 3], [7, 8, 9]], 34);
  // The specified voxels should be labeled with the new value
  t.is(cube.getDataValue([1, 2, 3]), 34);
  t.is(cube.getDataValue([7, 8, 9]), 34);
  // Some other voxel should not
  t.not(cube.getDataValue([11, 12, 13]), 34);
});

test("Data Api: downloadVolumeTracingCuboid should open a popup with the correct URL", t => {
  const { api } = t.context;
  const window = mockRequire.reRequire("libs/window");
  
  api.data.downloadVolumeTracingCuboid([1, 2, 3], [9, 8, 7]);
  
  t.true(window.open.calledOnce);
  t.true(window.open.calledWith("http://localhost:9000/data/datasets/2012-09-28_ex145_07x2/layers/64007765-cef9-4e31-b206-dba795b5be17/data?resolution=0&x=1&y=2&z=3&width=8&height=6&depth=4"));
});

test("Calling a skeleton api function in a volume tracing should throw an error", t => {
  const api = t.context.api;
  t.throws(() => api.tracing.getActiveNodeId());
});
