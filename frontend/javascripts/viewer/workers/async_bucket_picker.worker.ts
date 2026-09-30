import PriorityQueue from "js-priority-queue";
import type { Matrix4x4 } from "libs/mjs";
import sum from "lodash-es/sum";
import type { Vector3, Vector4, ViewMode } from "viewer/constants";
import constants from "viewer/constants";
import determineBucketsForFlight from "viewer/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForPlaneWithScanLines from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForPlaneWithFloodFill from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_flood_fill";
import type { LoadingStrategy, PlaneRects } from "viewer/store";
import { expose } from "./comlink_core";

type PriorityItem = {
  bucketAddress: Vector4;
  priority: number;
};

type ObliquePickerStrategy = "scanLines" | "floodFill";

const comparator = (b: PriorityItem, a: PriorityItem) => b.priority - a.priority;

const LOG_COMPARISON_EVERY_N_PICKS = 100;

// Dev-only: all-time samples (never reset) of both oblique picker strategies, collected while
// compareObliquePickerStrategies is enabled. Both strategies see the identical input of each
// real pick, so the comparison isn't confounded by different navigation between sessions.
const comparisonSamples: Record<
  ObliquePickerStrategy,
  { durations: number[]; bucketCounts: number[] }
> = {
  scanLines: { durations: [], bucketCounts: [] },
  floodFill: { durations: [], bucketCounts: [] },
};
let comparisonCount = 0;

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

function createBucketQueue() {
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

  return { bucketQueue, enqueueFunction };
}

function percentile(sortedValues: number[], p: number): number {
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length))];
}

function logComparisonStatistics() {
  const round = (value: number) => Number(value.toFixed(3));
  const statsPerStrategy = Object.fromEntries(
    Object.entries(comparisonSamples).map(([strategy, { durations, bucketCounts }]) => {
      const sortedDurations = [...durations].sort((a, b) => a - b);
      const totalDuration = sum(durations);
      return [
        strategy,
        {
          "mean [ms]": round(totalDuration / durations.length),
          "p50 [ms]": round(percentile(sortedDurations, 0.5)),
          "p95 [ms]": round(percentile(sortedDurations, 0.95)),
          "p99 [ms]": round(percentile(sortedDurations, 0.99)),
          "max [ms]": round(sortedDurations[sortedDurations.length - 1]),
          "buckets/pick": Math.round(sum(bucketCounts) / bucketCounts.length),
          "per bucket [µs]": round((1000 * totalDuration) / sum(bucketCounts)),
        },
      ];
    }),
  );
  const { scanLines, floodFill } = statsPerStrategy;
  console.log(
    `[bucketPick] ${comparisonCount} picks compared. floodFill vs. scanLines: ` +
      `mean ${(floodFill["mean [ms]"] / scanLines["mean [ms]"]).toFixed(2)}x, ` +
      `p95 ${(floodFill["p95 [ms]"] / scanLines["p95 [ms]"]).toFixed(2)}x`,
  );
  console.table(statsPerStrategy);
}

function determineBucketsForPlane(
  strategy: ObliquePickerStrategy,
  loadingStrategy: LoadingStrategy,
  denseMags: Array<Vector3>,
  position: Vector3,
  enqueueFunction: (bucketAddress: Vector4, priority: number) => void,
  matrix: Matrix4x4,
  logZoomStep: number,
  rects: PlaneRects,
  onScanLine: ((a: Vector3, b: Vector3) => void) | undefined,
  prefetchAlongViewAxis: boolean | undefined,
) {
  const determineBuckets =
    strategy === "floodFill"
      ? determineBucketsForPlaneWithFloodFill
      : determineBucketsForPlaneWithScanLines;
  determineBuckets(
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

function pick(
  viewMode: ViewMode,
  denseMags: Array<Vector3>,
  position: Vector3,
  sphericalCapRadius: number,
  matrix: Matrix4x4,
  logZoomStep: number,
  loadingStrategy: LoadingStrategy,
  rects: PlaneRects,
  collectScanLines?: boolean,
  obliquePickerStrategy: ObliquePickerStrategy = "scanLines",
  prefetchAlongViewAxis?: boolean,
  compareObliquePickerStrategies?: boolean,
): { buffer: ArrayBuffer; scanLines: Array<[Vector3, Vector3]> } {
  const { bucketQueue, enqueueFunction } = createBucketQueue();

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
  } else if (!compareObliquePickerStrategies) {
    determineBucketsForPlane(
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
  } else {
    const otherStrategy: ObliquePickerStrategy =
      obliquePickerStrategy === "floodFill" ? "scanLines" : "floodFill";
    // Alternate the order so that neither strategy systematically profits from running second
    // (e.g., warm caches / JIT state).
    const strategies: ObliquePickerStrategy[] =
      comparisonCount % 2 === 0
        ? [obliquePickerStrategy, otherStrategy]
        : [otherStrategy, obliquePickerStrategy];

    for (const strategy of strategies) {
      const isActiveStrategy = strategy === obliquePickerStrategy;
      // The other strategy fills its own (discarded) queue, so that both pay the same
      // enqueueing cost. Only the active strategy's result is used for rendering.
      const queue = isActiveStrategy ? { bucketQueue, enqueueFunction } : createBucketQueue();
      const startTime = performance.now();
      determineBucketsForPlane(
        strategy,
        loadingStrategy,
        denseMags,
        position,
        queue.enqueueFunction,
        matrix,
        logZoomStep,
        rects,
        isActiveStrategy ? onScanLine : undefined,
        prefetchAlongViewAxis,
      );
      comparisonSamples[strategy].durations.push(performance.now() - startTime);
      comparisonSamples[strategy].bucketCounts.push(queue.bucketQueue.length);
    }

    comparisonCount++;
    if (comparisonCount % LOG_COMPARISON_EVERY_N_PICKS === 0) {
      logComparisonStatistics();
    }
  }

  return { buffer: dequeueToArrayBuffer(bucketQueue), scanLines };
}

export default expose(pick);
