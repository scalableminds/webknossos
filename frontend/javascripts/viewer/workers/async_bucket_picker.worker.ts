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
  obliquePickerStrategy?: "scanLines" | "floodFill" | "wasm" | "floodFillWasm",
): Promise<{ buffer: ArrayBuffer; scanLines: Array<[Vector3, Vector3]> }> {
  console.time("bucketPick");
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
  } else if (obliquePickerStrategy === "wasm") {
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
    );
  } else if (obliquePickerStrategy === "floodFillWasm") {
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
    );
  } else {
    const determineBucketsForPlane =
      obliquePickerStrategy === "floodFill"
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
    );
  }

  const retval = { buffer: dequeueToArrayBuffer(bucketQueue), scanLines };
  console.timeEnd("bucketPick");
  return retval;
}

export default expose(pick);
