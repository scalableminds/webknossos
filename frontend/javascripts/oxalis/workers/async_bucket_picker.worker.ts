import PriorityQueue from "js-priority-queue";
import type { LoadingStrategy, PlaneRects } from "oxalis/store";
import type { Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4, ViewMode } from "oxalis/constants";
import constants from "oxalis/constants";
import determineBucketsForFlight from "oxalis/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForOblique from "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import { expose } from "./comlink_wrapper";

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

function pick(
  viewMode: ViewMode,
  mags: Array<Vector3>,
  position: Vector3,
  sphericalCapRadius: number,
  matrix: Matrix4x4,
  logZoomStep: number,
  loadingStrategy: LoadingStrategy,
  rects: PlaneRects,
): ArrayBuffer {
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

  if (viewMode === constants.MODE_ARBITRARY_PLANE) {
    determineBucketsForOblique(
      viewMode,
      loadingStrategy,
      mags,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      rects,
    );
  } else if (viewMode === constants.MODE_ARBITRARY) {
    determineBucketsForFlight(
      mags,
      position,
      sphericalCapRadius,
      enqueueFunction,
      matrix,
      logZoomStep,
    );
  } else {
    determineBucketsForOblique(
      viewMode,
      loadingStrategy,
      mags,
      position,
      enqueueFunction,
      matrix,
      logZoomStep,
      rects,
    );
  }

  return dequeueToArrayBuffer(bucketQueue);
}

export default expose(pick);
