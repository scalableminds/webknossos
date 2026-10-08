import update from "immutability-helper";
import { sleep } from "libs/utils";
import {
  createBucketResponseFunction,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import type { ElementClass } from "types/api_types";
import { type OrthoView, OrthoViews, type Vector3 } from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setPositionAction, setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { dispatchUndoAsync } from "viewer/model/actions/save_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import { setInputCatcherRects, setViewportAction } from "viewer/model/actions/view_mode_actions";
import {
  addToContourListAction,
  finishEditingAction,
  interpolateSegmentationLayerAction,
  resetContourAction,
  setActiveCellAction,
  startEditingAction,
} from "viewer/model/actions/volumetracing_actions";
import Dimensions from "viewer/model/dimensions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import Store from "viewer/store";
import { afterEach, describe, expect, it, type TestContext, vi } from "vitest";

// All ElementClass values that are valid for segmentation layers. uint24 is rejected
// explicitly (see model_initialization.ts), and float/double have no segment id range
// (see getSegmentIdRangeForElementClass).
const SEGMENTATION_ELEMENT_CLASSES: ElementClass[] = [
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "int8",
  "int16",
  "int32",
  "int64",
];

// The interpolation saga runs asynchronously (it fetches bucket data). Since it
// doesn't offer a completion callback, wait until it deregisters itself from
// operationContext (see operation_context_saga.ts) instead of guessing a delay.
async function waitUntilNotBusy() {
  // Give the saga a chance to register the operation before polling for its
  // completion. Otherwise, this could return prematurely because activeOperations
  // is still empty right after the dispatch (registration happens behind a mutex,
  // i.e. not necessarily synchronously).
  await sleep(0);
  while (Store.getState().operationContext.activeOperations.length > 0) {
    await sleep(5);
  }
}

async function setupInterpolationTest(context: WebknossosTestContext, elementClass: ElementClass) {
  await setupWebknossosForTesting(
    context,
    "volume",
    ({ tracings, annotationProto, dataset, annotation }) => ({
      tracings: tracings.map((tracing) =>
        tracing.typ === "Volume"
          ? update(tracing, { elementClass: { $set: elementClass } })
          : tracing,
      ),
      annotationProto,
      dataset,
      annotation: update(annotation, {
        settings: { volumeInterpolationAllowed: { $set: true } },
      }),
    }),
  );

  vi.mocked(context.mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
    createBucketResponseFunction({ volumeTracingId: elementClass, color: "uint8" }, 0, 0),
  );
  await context.api.data.reloadAllBuckets();
}

function brushActiveCellAt(position: Vector3, plane: OrthoView = OrthoViews.PLANE_XY) {
  Store.dispatch(setPositionAction(position));
  Store.dispatch(startEditingAction(position, plane));
  Store.dispatch(addToContourListAction(position));
  // As handleEndForDrawOrErase does, so that the next stroke has a contour of its own.
  Store.dispatch(finishEditingAction());
  Store.dispatch(resetContourAction());
}

async function runInterpolationTest(context: WebknossosTestContext, elementClass: ElementClass) {
  await setupInterpolationTest(context, elementClass);
  const { api } = context;

  const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
  const activeCellId = 5n;
  const brushCenter = [0, 0, 0] as Vector3;
  const interpolationDepth = 5;

  Store.dispatch(setToolAction(AnnotationTool.BRUSH));
  Store.dispatch(setActiveCellAction(activeCellId));

  // Label the segment on the first slice.
  brushActiveCellAt(brushCenter);
  // Label the segment again a few slices away, so that the slices in between
  // can be interpolated.
  brushActiveCellAt([brushCenter[0], brushCenter[1], brushCenter[2] + interpolationDepth]);

  Store.dispatch(interpolateSegmentationLayerAction());
  await waitUntilNotBusy();

  for (let z = 1; z < interpolationDepth; z++) {
    const readValue = await api.data.getDataValue(volumeTracingLayerName, [
      brushCenter[0],
      brushCenter[1],
      brushCenter[2] + z,
    ]);
    expect(Number(readValue), `Slice at z=${z} should be interpolated`).toBe(Number(activeCellId));
  }
}

describe("Volume Interpolation", () => {
  afterEach<WebknossosTestContext>(async (context) => {
    expect(hasRootSagaCrashed()).toBe(false);
    context.tearDownPullQueues();
  });

  it.for(SEGMENTATION_ELEMENT_CLASSES)(
    "should interpolate a segment for a %s volume layer",
    async (elementClass, context: TestContext) => {
      await runInterpolationTest(context as WebknossosTestContext, elementClass);
    },
  );

  it.for([OrthoViews.PLANE_XY, OrthoViews.PLANE_YZ, OrthoViews.PLANE_XZ] as const)(
    "should interpolate exactly between two identical slices in %s, in one undo step",
    async (plane, context: TestContext) => {
      await setupInterpolationTest(context as WebknossosTestContext, "uint32");
      const { api } = context as WebknossosTestContext;
      const layerName = api.data.getVolumeTracingLayerIds()[0];
      const activeCellId = 5;
      const interpolationDepth = 5;
      // (a, b) within the viewport, c along its normal; around (40, 40, 40).
      const [u, v, w] = Dimensions.getIndices(plane);
      const at = (a: number, b: number, c: number): Vector3 => {
        const position: Vector3 = [0, 0, 0];
        position[u] = 40 + a;
        position[v] = 40 + b;
        position[w] = 40 + c;
        return position;
      };
      const slice = (c: number) =>
        api.data
          .getDataForBoundingBox(layerName, { min: at(-10, -10, c), max: at(11, 11, c + 1) }, 0)
          .then((data) => Array.from(data, Number));

      // The interpolation only covers what the viewport shows, so the viewports
      // need a size: 64 px at zoom 1 are 64 voxels in each direction. Setting
      // the rects clamps the zoom, hence setting it afterwards.
      const rect = { top: 0, left: 0, width: 64, height: 64 };
      Store.dispatch(
        setInputCatcherRects({
          PLANE_XY: rect,
          PLANE_YZ: rect,
          PLANE_XZ: rect,
          TDView: rect,
          flightViewport: rect,
        }),
      );
      Store.dispatch(setZoomStepAction(1));
      Store.dispatch(setViewportAction(plane));
      Store.dispatch(updateUserSettingAction("brushSize", 10));
      Store.dispatch(setToolAction(AnnotationTool.BRUSH));
      Store.dispatch(setActiveCellAction(BigInt(activeCellId)));
      brushActiveCellAt(at(0, 0, 0), plane);
      brushActiveCellAt(at(0, 0, interpolationDepth), plane);
      const labeledSlice = await slice(0);
      expect(labeledSlice.filter((value) => value === activeCellId).length).toBeGreaterThan(0);

      Store.dispatch(interpolateSegmentationLayerAction());
      await waitUntilNotBusy();

      // Both labeled slices hold the same dab, so every slice in between is that dab, too.
      for (let c = 1; c < interpolationDepth; c++) {
        expect(await slice(c), `slice ${c}`).toEqual(labeledSlice);
      }
      // Nothing beyond the labeled slices.
      const emptySlice = labeledSlice.map(() => 0);
      expect(await slice(-1)).toEqual(emptySlice);
      expect(await slice(interpolationDepth + 1)).toEqual(emptySlice);
      // The interpolated slices are propagated to the coarser mags.
      expect(await api.data.getDataValue(layerName, at(0, 0, 2), 1), "mag 2").toBe(activeCellId);

      // One undo removes all interpolated slices, but not the labeled ones.
      await dispatchUndoAsync(Store.dispatch);
      for (let c = 1; c < interpolationDepth; c++) {
        expect(await slice(c), `slice ${c} after undo`).toEqual(emptySlice);
      }
      expect(await slice(0)).toEqual(labeledSlice);
      expect(await slice(interpolationDepth)).toEqual(labeledSlice);
    },
  );
});
