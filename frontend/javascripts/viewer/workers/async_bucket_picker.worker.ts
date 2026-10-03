import PriorityQueue from "js-priority-queue";
import type { Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4, ViewMode } from "viewer/constants";
import constants from "viewer/constants";
import determineBucketsForFlight from "viewer/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForPlane from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_rows";
import { countingSortToArrayBuffer } from "viewer/model/bucket_data_handling/bucket_priority_sort";
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

function pick(
  viewMode: ViewMode,
  denseMags: Array<Vector3>,
  position: Vector3,
  sphericalCapRadius: number,
  matrix: Matrix4x4,
  logZoomStep: number,
  loadingStrategy: LoadingStrategy,
  rects: PlaneRects,
): ArrayBuffer {
  if (viewMode !== constants.MODE_FLIGHT) {
    // The oblique picker's priorities are small integers, so a counting sort is cheaper than
    // the priority queue.
    const addresses: number[] = [];
    const priorities: number[] = [];
    determineBucketsForPlane(
      loadingStrategy,
      denseMags,
      position,
      (bucketAddress: Vector4, priority: number) => {
        addresses.push(bucketAddress[0], bucketAddress[1], bucketAddress[2], bucketAddress[3]);
        priorities.push(priority);
      },
      matrix,
      logZoomStep,
      rects,
    );
    return countingSortToArrayBuffer(addresses, priorities);
  }

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

  determineBucketsForFlight(
    denseMags,
    position,
    sphericalCapRadius,
    enqueueFunction,
    matrix,
    logZoomStep,
  );

  return dequeueToArrayBuffer(bucketQueue);
}

export default expose(pick);
