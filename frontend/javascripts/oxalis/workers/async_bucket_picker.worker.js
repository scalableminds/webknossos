// @flow
import PriorityQueue from "js-priority-queue";

import type { Area } from "oxalis/model/accessors/flycam_accessor";
import type { LoadingStrategy } from "oxalis/store";
import type { OrthoViewMap, Vector3, Vector4 } from "oxalis/constants";
import determineBucketsForOrthogonal from "oxalis/model/bucket_data_handling/bucket_picker_strategies/orthogonal_bucket_picker";

import { expose, proxy } from "./comlink_wrapper";

const comparator = (b, a) => b.priority - a.priority;

function pick(
  resolutions: Array<Vector3>,
  loadingStrategy: LoadingStrategy,
  logZoomStep: number,
  anchorPoint: Vector4,
  areas: OrthoViewMap<Area>,
  subBucketLocality: Vector3,
  abortLimit?: number,
): Array<{ bucketAddress: Vector4, priority: number }> {
  console.log("starting async picking");
  const bucketQueue = new PriorityQueue({
    // small priorities take precedence
    comparator,
  });
  const enqueueFunction = (bucketAddress, priority) => {
    bucketQueue.queue({ bucketAddress, priority });
  };

  determineBucketsForOrthogonal(
    resolutions,
    enqueueFunction,
    loadingStrategy,
    logZoomStep,
    anchorPoint,
    areas,
    subBucketLocality,
    abortLimit,
  );

  const bucketsWithPriorities = [];
  // Consume priority queue until we maxed out the capacity
  while (bucketQueue.length > 0) {
    const { bucketAddress, priority } = bucketQueue.dequeue();

    bucketsWithPriorities.push({ bucketAddress, priority });
  }

  return bucketsWithPriorities;
}

export default expose<typeof pick>(pick);
