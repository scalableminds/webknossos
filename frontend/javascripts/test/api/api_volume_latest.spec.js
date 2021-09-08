// @noflow
import { AnnotationToolEnum } from "oxalis/constants";
import { __setupOxalis } from "test/helpers/apiHelpers";
import test from "ava";
import window from "libs/window";

import { tracing as TRACING } from "../fixtures/volumetracing_server_objects";

// All the mocking is done in the helpers file, so it can be reused for both skeleton and volume API
test.beforeEach(t => __setupOxalis(t, "volume"));

test("getActiveCellId should get the id of the active segment", t => {
  const { api } = t.context;
  t.is(api.tracing.getActiveCellId(), TRACING.activeSegmentId);
});

test("setActiveCell should set the active segment id", t => {
  const { api } = t.context;
  api.tracing.setActiveCell(27);
  t.is(api.tracing.getActiveCellId(), 27);
});

test("getAnnotationTool should get the current tool", t => {
  const { api } = t.context;
  t.is(api.tracing.getAnnotationTool(), AnnotationToolEnum.MOVE);
});

test("setAnnotationTool should set the current tool", t => {
  const { api } = t.context;
  api.tracing.setAnnotationTool(AnnotationToolEnum.TRACE);
  t.is(api.tracing.getAnnotationTool(), AnnotationToolEnum.TRACE);
  api.tracing.setAnnotationTool(AnnotationToolEnum.BRUSH);
  t.is(api.tracing.getAnnotationTool(), AnnotationToolEnum.BRUSH);
});

test("setAnnotationTool should throw an error for an invalid tool", t => {
  const { api } = t.context;
  t.throws(() => api.tracing.setAnnotationTool(67));
  t.throws(() => api.tracing.setAnnotationTool("myTool"));
  t.throws(() => api.tracing.setAnnotationTool());
});

test("Data API: labelVoxels should label a list of voxels", t => {
  const { api, model } = t.context;
  const { cube } = model.getSegmentationTracingLayer();

  api.data.labelVoxels([[1, 2, 3], [7, 8, 9]], 34);
  // The specified voxels should be labeled with the new value
  t.is(cube.getDataValue([1, 2, 3]), 34);
  t.is(cube.getDataValue([7, 8, 9]), 34);
  // Some other voxel should not
  t.not(cube.getDataValue([11, 12, 13]), 34);
});

test("Data API: getVolumeTracingLayerName should return the name of the volume tracing layer", t => {
  const { api } = t.context;
  t.is(api.data.getVolumeTracingLayerName(), "segmentation");
});

test("Data API: downloadRawDataCuboid should open a popup with the correct URL", async t => {
  const { api } = t.context;

  await api.data.downloadRawDataCuboid("color", [1, 2, 3], [9, 8, 7]);

  t.true(window.open.calledOnce);
  t.true(
    window.open.calledWith(
      "http://localhost:9000/data/datasets/Connectomics department/ROI2017_wkw/layers/color/data?resolution=0&token=secure-token&x=1&y=2&z=3&width=8&height=6&depth=4",
    ),
  );
});

test("Calling a skeleton api function in a volume tracing should throw an error", t => {
  const { api } = t.context;
  t.throws(() => api.tracing.getActiveNodeId());
});
