import PriorityQueue from "js-priority-queue";
import type { Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4, ViewMode } from "viewer/constants";
import constants from "viewer/constants";
import determineBucketsForFlight from "viewer/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForPlaneWithScanLines from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForPlaneWithFloodFill from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_flood_fill";
import determineBucketsForPlaneWithFloodFillWasm from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_flood_fill_wasm";
import determineBucketsForPlaneWithWasm from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_wasm";
import type { LoadingStrategy, PlaneRects } from "viewer/store";
import { expose } from "./comlink_core";

type PriorityItem = {
  bucketAddress: Vector4;
  priority: number;
};

const comparator = (b: PriorityItem, a: PriorityItem) => b.priority - a.priority;

type ObliquePickerStrategy = "scanLines" | "floodFill" | "wasm" | "floodFillWasm";

// Dev-only production instrumentation: accumulated across all pick() calls (not reset), so
// the logged averages are all-time, growing more stable the longer the session runs. Logged
// every 100 calls rather than every call, to avoid flooding the console on fast camera moves.
let totalPickDurationMs = 0;
let pickCallCount = 0;
let totalBucketsPicked = 0;

// Dev-only "shadow mode" instrumentation: when shadowObliquePickerStrategy is set, every real
// pick() also (redundantly) runs that strategy against identical parameters purely to time it,
// so the two strategies get compared on the exact same per-call workload (same camera position/
// zoom/bucket count) instead of drifting apart across two separately-navigated sessions. Only
// covers non-flight picks, since flight mode has just one strategy to begin with.
let totalRealDurationMs = 0;
let totalRealBucketsPicked = 0;
let totalShadowDurationMs = 0;
let totalShadowBucketsPicked = 0;
let shadowComparisonCount = 0;

function dequeueToArrayBuffer(bucketQueue: PriorityQueue<PriorityItem>): ArrayBuffer {
  const itemCount = bucketQueue.length;
  const intsPerItem = 5; // [x, y, z, zoomStep, priority]

  const bytesPerInt = 4; // Since we use uint32

  const buffer = new ArrayBuffer(itemCount * intsPerItem * bytesPerInt);
  const bucketsWithPriorities = new Uint32Array(buffer);
  let currentElementIndex = 0;

  while (bucketQueue.length > 0) {
    const { bucketAddress, priority } = bucketQueue.dequeue();
    const currentBufferIndex = currentElementIndex * intsPerItem;
    bucketsWithPriorities[currentBufferIndex] = bucketAddress[0];
    bucketsWithPriorities[currentBufferIndex + 1] = bucketAddress[1];
    bucketsWithPriorities[currentBufferIndex + 2] = bucketAddress[2];
    bucketsWithPriorities[currentBufferIndex + 3] = bucketAddress[3];
    bucketsWithPriorities[currentBufferIndex + 4] = priority;
    currentElementIndex++;
  }

  return buffer;
}

async function runObliquePicker(
  strategy: ObliquePickerStrategy | undefined,
  loadingStrategy: LoadingStrategy,
  denseMags: Array<Vector3>,
  position: Vector3,
  enqueueFunction: (bucketAddress: Vector4, priority: number) => void,
  matrix: Matrix4x4,
  logZoomStep: number,
  rects: PlaneRects,
  onScanLine: ((a: Vector3, b: Vector3) => void) | undefined,
  prefetchAlongViewAxis: boolean | undefined,
): Promise<void> {
  if (strategy === "wasm") {
    await determineBucketsForPlaneWithWasm(
      loadingStrategy,
      denseMags,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      rects,
      undefined,
      onScanLine,
      prefetchAlongViewAxis,
    );
  } else if (strategy === "floodFillWasm") {
    await determineBucketsForPlaneWithFloodFillWasm(
      loadingStrategy,
      denseMags,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      rects,
      undefined,
      onScanLine,
      prefetchAlongViewAxis,
    );
  } else {
    const determineBucketsForPlane =
      strategy === "floodFill"
        ? determineBucketsForPlaneWithFloodFill
        : determineBucketsForPlaneWithScanLines;
    determineBucketsForPlane(
      loadingStrategy,
      denseMags,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      rects,
      undefined,
      onScanLine,
      prefetchAlongViewAxis,
    );
  }
}

async function pick(
  viewMode: ViewMode,
  denseMags: Array<Vector3>,
  position: Vector3,
  sphericalCapRadius: number,
  matrix: Matrix4x4,
  logZoomStep: number,
  loadingStrategy: LoadingStrategy,
  rects: PlaneRects,
  collectScanLines?: boolean,
  obliquePickerStrategy?: ObliquePickerStrategy,
  prefetchAlongViewAxis?: boolean,
  shadowObliquePickerStrategy?: ObliquePickerStrategy,
): Promise<{ buffer: ArrayBuffer; scanLines: Array<[Vector3, Vector3]> }> {
  const startTime = performance.now();
  const bucketQueue = new PriorityQueue({
    // small priorities take precedence
    comparator,
  });

  const enqueueFunction = (bucketAddress: Vector4, priority: number) => {
    bucketQueue.queue({
      bucketAddress,
      priority,
    });
  };

  const scanLines: Array<[Vector3, Vector3]> = [];
  const onScanLine = collectScanLines
    ? (a: Vector3, b: Vector3) => scanLines.push([a, b])
    : undefined;

  if (viewMode === constants.MODE_FLIGHT) {
    determineBucketsForFlight(
      denseMags,
      position,
      sphericalCapRadius,
      enqueueFunction,
      matrix,
      logZoomStep,
    );
  } else {
    const realPickStart = performance.now();
    await runObliquePicker(
      obliquePickerStrategy,
      loadingStrategy,
      denseMags,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      rects,
      onScanLine,
      prefetchAlongViewAxis,
    );
    const realPickDuration = performance.now() - realPickStart;
    // Captured here (rather than after dequeueToArrayBuffer below): dequeueToArrayBuffer()
    // empties the queue as it reads it.
    const realBucketCount = bucketQueue.length;

    if (
      shadowObliquePickerStrategy != null &&
      shadowObliquePickerStrategy !== obliquePickerStrategy
    ) {
      // The shadow run's picks are only counted, never enqueued -- it must not affect the
      // actual buckets returned/rendered, only be timed for comparison.
      let shadowBucketCount = 0;
      const shadowEnqueueFunction = () => {
        shadowBucketCount++;
      };
      const shadowStart = performance.now();
      await runObliquePicker(
        shadowObliquePickerStrategy,
        loadingStrategy,
        denseMags,
        position,
        shadowEnqueueFunction,
        matrix,
        logZoomStep,
        rects,
        undefined,
        prefetchAlongViewAxis,
      );
      const shadowDuration = performance.now() - shadowStart;

      totalRealDurationMs += realPickDuration;
      totalRealBucketsPicked += realBucketCount;
      totalShadowDurationMs += shadowDuration;
      totalShadowBucketsPicked += shadowBucketCount;
      shadowComparisonCount++;

      if (shadowComparisonCount % 100 === 0) {
        const realPerCall = totalRealDurationMs / shadowComparisonCount;
        const realPerBucket = totalRealDurationMs / totalRealBucketsPicked;
        const shadowPerCall = totalShadowDurationMs / shadowComparisonCount;
        const shadowPerBucket = totalShadowDurationMs / totalShadowBucketsPicked;
        console.log(
          `[bucketPick:shadow] comparisonCount=${shadowComparisonCount} ` +
            `real(${obliquePickerStrategy})=${realPerCall.toFixed(3)}ms/call,${realPerBucket.toFixed(5)}ms/bucket ` +
            `shadow(${shadowObliquePickerStrategy})=${shadowPerCall.toFixed(3)}ms/call,${shadowPerBucket.toFixed(5)}ms/bucket ` +
            `shadowIsXFasterPerBucket=${(realPerBucket / shadowPerBucket).toFixed(2)}`,
        );
      }
    }
  }

  const bucketCount = bucketQueue.length;
  const retval = { buffer: dequeueToArrayBuffer(bucketQueue), scanLines };

  totalPickDurationMs += performance.now() - startTime;
  pickCallCount++;
  totalBucketsPicked += bucketCount;

  if (pickCallCount % 100 === 0) {
    console.log(
      `[bucketPick] callCount=${pickCallCount} ` +
        `durationPerCall=${(totalPickDurationMs / pickCallCount).toFixed(3)}ms ` +
        `durationPerBucket=${(totalPickDurationMs / totalBucketsPicked).toFixed(5)}ms`,
    );
  }

  return retval;
}

export default expose(pick);
