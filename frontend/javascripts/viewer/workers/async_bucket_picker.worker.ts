import PriorityQueue from "js-priority-queue";
import type { Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4, ViewMode } from "viewer/constants";
import constants from "viewer/constants";
import determineBucketsForFlight from "viewer/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForPlane from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
import determineBucketsForPlaneByRows from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_rows";
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

type ObliquePicker = typeof determineBucketsForPlane;
type ObliquePickArguments = [
  loadingStrategy: LoadingStrategy,
  denseMags: Array<Vector3>,
  position: Vector3,
  matrix: Matrix4x4,
  logZoomStep: number,
  rects: PlaneRects,
];

function pickIntoPriorityQueue(picker: ObliquePicker, args: ObliquePickArguments): ArrayBuffer {
  const [loadingStrategy, denseMags, position, matrix, logZoomStep, rects] = args;
  const bucketQueue = new PriorityQueue<PriorityItem>({
    // small priorities take precedence
    comparator,
  });
  picker(
    loadingStrategy,
    denseMags,
    position,
    (bucketAddress, priority) => bucketQueue.queue({ bucketAddress, priority }),
    matrix,
    logZoomStep,
    rects,
  );
  return dequeueToArrayBuffer(bucketQueue);
}

function pickWithCountingSort(picker: ObliquePicker, args: ObliquePickArguments): ArrayBuffer {
  const [loadingStrategy, denseMags, position, matrix, logZoomStep, rects] = args;
  const addresses: number[] = [];
  const priorities: number[] = [];
  picker(
    loadingStrategy,
    denseMags,
    position,
    (bucketAddress, priority) => {
      addresses.push(bucketAddress[0], bucketAddress[1], bucketAddress[2], bucketAddress[3]);
      priorities.push(priority);
    },
    matrix,
    logZoomStep,
    rects,
  );
  return countingSortToArrayBuffer(addresses, priorities);
}

// Dev-only comparison (see WkDevFlags.bucketDebugging.compareObliquePickers): every oblique pick
// runs all variants on the same input. Each is timed from picking until the sorted buffer is
// written. Only the first variant's result is used for rendering.
const COMPARISON_VARIANTS: Array<{
  name: string;
  run: (args: ObliquePickArguments) => ArrayBuffer;
}> = [
  {
    name: "flood fill + priority queue",
    run: (args) => pickIntoPriorityQueue(determineBucketsForPlane, args),
  },
  {
    name: "rows + priority queue",
    run: (args) => pickIntoPriorityQueue(determineBucketsForPlaneByRows, args),
  },
  {
    name: "flood fill + counting sort",
    run: (args) => pickWithCountingSort(determineBucketsForPlane, args),
  },
  {
    name: "rows + counting sort",
    run: (args) => pickWithCountingSort(determineBucketsForPlaneByRows, args),
  },
];
const LOG_COMPARISON_EVERY_N_PICKS = 100;
const BYTES_PER_BUCKET = 5 * 4;
// All-time samples (never reset), so the statistics become more stable the longer it runs.
const comparisonSamples = COMPARISON_VARIANTS.map(() => ({
  durations: [] as number[],
  bucketCounts: [] as number[],
}));
let comparisonCount = 0;

function pickAndCompare(args: ObliquePickArguments): ArrayBuffer {
  const results: ArrayBuffer[] = [];
  // Rotate the order, so that no variant systematically profits from running first or last
  // (e.g., due to JIT state or pending garbage collection).
  for (let i = 0; i < COMPARISON_VARIANTS.length; i++) {
    const variantIndex = (comparisonCount + i) % COMPARISON_VARIANTS.length;
    const startTime = performance.now();
    const buffer = COMPARISON_VARIANTS[variantIndex].run(args);
    comparisonSamples[variantIndex].durations.push(performance.now() - startTime);
    comparisonSamples[variantIndex].bucketCounts.push(buffer.byteLength / BYTES_PER_BUCKET);
    results[variantIndex] = buffer;
  }
  comparisonCount++;
  if (comparisonCount % LOG_COMPARISON_EVERY_N_PICKS === 0) {
    logComparisonStatistics();
  }
  return results[0];
}

function percentile(sortedValues: number[], p: number): number {
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length))];
}

function logComparisonStatistics(): void {
  const round = (value: number) => Number(value.toFixed(3));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const statistics = COMPARISON_VARIANTS.map(({ name }, i) => {
    const { durations, bucketCounts } = comparisonSamples[i];
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const totalDuration = sum(durations);
    return {
      name,
      "mean [ms]": round(totalDuration / durations.length),
      "p50 [ms]": round(percentile(sortedDurations, 0.5)),
      "p95 [ms]": round(percentile(sortedDurations, 0.95)),
      "p99 [ms]": round(percentile(sortedDurations, 0.99)),
      "max [ms]": round(sortedDurations[sortedDurations.length - 1]),
      "buckets/pick": Math.round(sum(bucketCounts) / bucketCounts.length),
      "per bucket [µs]": round((1000 * totalDuration) / sum(bucketCounts)),
    };
  });
  const baselineMean = statistics[0]["mean [ms]"];
  console.log(
    `[bucketPick] ${comparisonCount} picks compared. Speedup of the mean vs. ${statistics[0].name}: ` +
      statistics
        .slice(1)
        .map((s) => `${s.name} ${(baselineMean / s["mean [ms]"]).toFixed(2)}x`)
        .join(", "),
  );
  console.table(Object.fromEntries(statistics.map(({ name, ...rest }) => [name, rest])));
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
  compareObliquePickers?: boolean,
): ArrayBuffer {
  if (viewMode !== constants.MODE_FLIGHT && compareObliquePickers) {
    return pickAndCompare([loadingStrategy, denseMags, position, matrix, logZoomStep, rects]);
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
    determineBucketsForPlane(
      loadingStrategy,
      denseMags,
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
