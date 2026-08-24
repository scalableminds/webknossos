import update from "immutability-helper";
import { sleep } from "libs/utils";
import {
  createBucketResponseFunction,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import type { ElementClass } from "types/api_types";
import { OrthoViews, type Vector3 } from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import {
  addToContourListAction,
  finishEditingAction,
  interpolateSegmentationLayerAction,
  setActiveCellAction,
  startEditingAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import Store from "viewer/store";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function brushActiveCellAt(position: Vector3) {
  Store.dispatch(setPositionAction(position));
  Store.dispatch(startEditingAction(position, OrthoViews.PLANE_XY));
  Store.dispatch(addToContourListAction(position));
  Store.dispatch(finishEditingAction());
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
    await context.api.tracing.save();
    expect(hasRootSagaCrashed()).toBe(false);
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>("should interpolate a segment for a uint32 volume layer", async (context) => {
    await runInterpolationTest(context, "uint32");
  });

  it<WebknossosTestContext>("should interpolate a segment for a uint64 volume layer", async (context) => {
    await runInterpolationTest(context, "uint64");
  });
});
