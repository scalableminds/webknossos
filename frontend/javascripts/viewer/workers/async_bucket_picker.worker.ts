import PriorityQueue from "js-priority-queue";
import type { Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4, ViewMode } from "viewer/constants";
import constants from "viewer/constants";
import determineBucketsForFlight from "viewer/model/bucket_data_handling/bucket_picker_strategies/flight_bucket_picker";
import determineBucketsForPlaneWithFloodFill from "viewer/model/bucket_data_handling/bucket_picker_strategies/legacy/oblique_bucket_picker_flood_fill";
import determineBucketsForPlaneWithScanLines from "viewer/model/bucket_data_handling/bucket_picker_strategies/legacy/oblique_bucket_picker_scan_lines";
import determineBucketsForPlane from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker";
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

type ObliquePickArguments = [
  loadingStrategy: LoadingStrategy,
  denseMags: Array<Vector3>,
  position: Vector3,
  matrix: Matrix4x4,
  logZoomStep: number,
  rects: PlaneRects,
];

function pickWithCountingSort(args: ObliquePickArguments): ArrayBuffer {
  const [loadingStrategy, denseMags, position, matrix, logZoomStep, rects] = args;
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

// TEMPORARY (revert before merging): dev-only comparison of the oblique bucket pickers, see
// WkDevFlags.bucketDebugging.compareObliquePickers. Every oblique pick runs all variants on the
// same input. Each is timed from picking until the sorted buffer is written. Only the first
// variant's result is used for rendering.
function pickIntoPriorityQueue(
  picker: typeof determineBucketsForPlane,
  args: ObliquePickArguments,
): ArrayBuffer {
  const [loadingStrategy, denseMags, position, matrix, logZoomStep, rects] = args;
  const bucketQueue = new PriorityQueue<PriorityItem>({ comparator });
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
const COMPARISON_VARIANTS: Array<{
  name: string;
  run: (args: ObliquePickArguments) => ArrayBuffer;
}> = [
  { name: "rows + counting sort (new)", run: pickWithCountingSort },
  {
    name: "flood fill + priority queue (#10010)",
    run: (args) => pickIntoPriorityQueue(determineBucketsForPlaneWithFloodFill, args),
  },
  {
    name: "scan lines + priority queue (master)",
    run: (args) => pickIntoPriorityQueue(determineBucketsForPlaneWithScanLines, args),
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
  // Rotate the order, so that no variant systematically profits from running first or last.
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
  const newMean = statistics[0]["mean [ms]"];
  console.log(
    `[bucketPick] ${comparisonCount} picks compared. Mean vs. ${statistics[0].name}: ` +
      statistics
        .slice(1)
        .map((s) => `${s.name} ${(s["mean [ms]"] / newMean).toFixed(2)}x slower`)
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
  if (viewMode !== constants.MODE_FLIGHT) {
    const args: ObliquePickArguments = [
      loadingStrategy,
      denseMags,
      position,
      matrix,
      logZoomStep,
      rects,
    ];
    return compareObliquePickers ? pickAndCompare(args) : pickWithCountingSort(args);
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
