import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import window from "libs/window";
import {
  tracing as TRACING,
  annotation as ANNOTATION,
} from "../fixtures/volumetracing_server_objects";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";

// All the mocking is done in the helpers file, so it can be reused for both skeleton and volume API
describe("API Volume", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "volume");
  });

  afterEach<WebknossosTestContext>((context) => {
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>("getActiveCellId should get the id of the active segment", ({
    api,
  }) => {
    expect(api.tracing.getActiveCellId()).toBe(TRACING.activeSegmentId);
  });

  it<WebknossosTestContext>("setActiveCell should set the active segment id", ({ api }) => {
    api.tracing.setActiveCell(27);
    expect(api.tracing.getActiveCellId()).toBe(27);
  });

  it<WebknossosTestContext>("getAnnotationTool should get the current tool", ({ api }) => {
    expect(api.tracing.getAnnotationTool()).toBe(AnnotationTool.MOVE.id);
  });

  it<WebknossosTestContext>("setAnnotationTool should set the current tool", ({ api }) => {
    api.tracing.setAnnotationTool(AnnotationTool.TRACE.id);
    expect(api.tracing.getAnnotationTool()).toBe(AnnotationTool.TRACE.id);

    api.tracing.setAnnotationTool(AnnotationTool.BRUSH.id);
    expect(api.tracing.getAnnotationTool()).toBe(AnnotationTool.BRUSH.id);
  });

  it<WebknossosTestContext>("setAnnotationTool should throw an error for an invalid tool", ({
    api,
  }) => {
    expect(() => api.tracing.setAnnotationTool(67 as any)).toThrow();
    expect(() => api.tracing.setAnnotationTool("myTool" as any)).toThrow();
    expect(() => api.tracing.setAnnotationTool(undefined as any)).toThrow();
  });

  it<WebknossosTestContext>("Data API: labelVoxels should label a list of voxels", async ({
    api,
  }) => {
    const volumeTracingId = api.data.getVolumeTracingLayerIds()[0];
    api.data.labelVoxels(
      [
        [1, 2, 3],
        [7, 8, 9],
      ],
      34,
    );

    // The specified voxels should be labeled with the new value
    expect(await api.data.getDataValue(volumeTracingId, [1, 2, 3])).toBe(34);
    expect(await api.data.getDataValue(volumeTracingId, [7, 8, 9])).toBe(34);

    // Some other voxel should not
    expect(await api.data.getDataValue(volumeTracingId, [11, 12, 13])).not.toBe(34);
  });

  it<WebknossosTestContext>("Data API: getVolumeTracingLayerName should return the name of the volume tracing layer", ({
    api,
  }) => {
    expect(api.data.getVolumeTracingLayerName()).toBe(ANNOTATION.annotationLayers[0].tracingId);
  });

  it<WebknossosTestContext>("Data API: downloadRawDataCuboid should open a popup with the correct URL", async ({
    api,
  }) => {
    const openSpy = vi.spyOn(window, "open");

    await api.data.downloadRawDataCuboid("color", [1, 2, 3], [9, 8, 7]);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      "http://localhost:9000/data/datasets/Connectomics department/ROI2017_wkw/layers/color/data?mag=1-1-1&token=secure-token&x=1&y=2&z=3&width=8&height=6&depth=4",
    );
  });

  it<WebknossosTestContext>("Calling a skeleton api function in a volume tracing should throw an error", ({
    api,
  }) => {
    expect(() => api.tracing.getActiveNodeId()).toThrow();
  });
});
