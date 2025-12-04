/*
 * This module tests the BucketSnapshot class which depends
 * on the async functions for compressing/decompressing bucket data
 * and for the actual fetch of the backend's bucket data.
 * To properly test the various orders in which these async functions
 * can return, a PlanExecutor is defined in this module that can
 * process a "plan". Each plan defines the order of events that happen
 * and the expected result.
 */
import { describe, it, expect } from "vitest";
import BucketSnapshot, {
  type PendingOperation,
} from "viewer/model/bucket_data_handling/bucket_snapshot";
import Deferred from "libs/async/deferred";
import type { BucketDataArray, ElementClass } from "types/api_types";
import { uint8ToTypedBuffer } from "viewer/model/helpers/typed_buffer";

/*
 * The MockCompressor provides the async compress and decompress
 * functions. These can be controlled from within the test plans
 * with resolveNextCompression/Decompression.
 */
class MockCompressor {
  private compressionQueue: Array<Deferred<void, void>> = [];
  private decompressionQueue: Array<Deferred<void, void>> = [];

  resolveCompressionCounter: number = 0;
  resolveDecompressionCounter: number = 0;

  async compressTypedArray(bucketData: BucketDataArray): Promise<Uint8Array<ArrayBuffer>> {
    const deferred = new Deferred<void, void>();
    this.compressionQueue.push(deferred);
    this.updateQueues();
    await deferred.promise();
    return new Uint8Array(bucketData.buffer.slice());
  }

  async decompressToTypedArray(
    compressedData: Uint8Array<ArrayBuffer>,
    elementClass: ElementClass,
  ): Promise<BucketDataArray> {
    const deferred = new Deferred<void, void>();
    this.decompressionQueue.push(deferred);
    this.updateQueues();
    await deferred.promise();
    return uint8ToTypedBuffer(compressedData, elementClass);
  }

  resolveNextCompression() {
    this.resolveCompressionCounter++;
    this.updateQueues();
  }

  resolveNextDecompression() {
    this.resolveDecompressionCounter++;
    this.updateQueues();
  }

  private updateQueues() {
    while (this.resolveCompressionCounter > 0 && this.compressionQueue.length > 0) {
      this.resolveCompressionCounter--;
      const next = this.compressionQueue.shift();
      next?.resolve();
    }

    while (this.resolveDecompressionCounter > 0 && this.decompressionQueue.length > 0) {
      this.resolveDecompressionCounter--;
      const next = this.decompressionQueue.shift();
      next?.resolve();
    }
  }
}

class PlanExecutor {
  constructor(
    private plan: {
      beforeInstantiation: string[];
      beforeRestore1: string[];
      afterRestore1: string[];
      beforeRestore2: string[];
    },
    private mockCompressor: MockCompressor,
    private backendDeferred: Deferred<void, void> | undefined,
  ) {}

  async executeStep(
    step: "beforeInstantiation" | "beforeRestore1" | "afterRestore1" | "beforeRestore2",
  ) {
    for (const action of this.plan[step]) {
      await this.processAction(action);
    }
  }

  async processAction(action: string) {
    if (action === "resolveBackendData") {
      if (this.backendDeferred == null) {
        throw new Error("Cannot process resolveBackendData");
      }
      this.backendDeferred.resolve();
    } else if (action === "resolveCompression") {
      this.mockCompressor.resolveNextCompression();
    } else if (action === "resolveDecompression") {
      this.mockCompressor.resolveNextDecompression();
    } else {
      throw new Error("Unexpected action");
    }
  }
}

type ExpectParams = {
  newPendingOperations: PendingOperation[];
  pendingOperations: PendingOperation[];
  needsMergeWithBackendData: boolean;
  newData: BucketDataArray;
  localData: BucketDataArray;
  backendData: BucketDataArray | undefined;
};

const expectUnmerged = (p: ExpectParams) => {
  expect(p.newPendingOperations).toEqual(p.pendingOperations);
  expect(p.needsMergeWithBackendData).toBeTruthy();
  expect(p.newData).toEqual(p.localData);
};

const expectMerged = (p: ExpectParams) => {
  expect(p.newPendingOperations).toEqual([]);
  expect(p.needsMergeWithBackendData).toBeFalsy();

  const mergedData = p.backendData || p.localData;
  for (const fn of p.pendingOperations) {
    fn(mergedData);
  }

  expect(p.newData).toEqual(mergedData);
};

const plans = [
  /*
    When a plan is executed, the overall events that happen are:
    - executeStep("beforeInstantiation")
    - new BucketSnapshot(...)
    - executeStep("beforeRestore1");
    - snapshot.getDataForRestore();
    - executeStep("afterRestore1");
    - expect1(...);
    - executeStep("beforeRestore2");
    - getDataForRestore();
    - expect2(...)
   */

  {
    // Compression is "slow" (never happens). Backend
    // data is not available, either.
    beforeInstantiation: [],
    beforeRestore1: [],
    afterRestore1: [],
    expect1: expectUnmerged,
    beforeRestore2: [],
    expect2: expectUnmerged,
  },
  {
    // Backend data is already there. Compression/decompression
    // only kicks in after the first restore.
    beforeInstantiation: ["resolveBackendData"],
    beforeRestore1: [],
    afterRestore1: [],
    expect1: expectMerged,
    beforeRestore2: ["resolveCompression", "resolveDecompression"],
    expect2: expectMerged,
  },
  {
    // Compression kicks in before first restore, but backend data only
    // appears after first restore.
    beforeInstantiation: [],
    beforeRestore1: ["resolveCompression", "resolveDecompression"],
    afterRestore1: ["resolveBackendData"],
    expect1: expectUnmerged,
    beforeRestore2: ["resolveDecompression"], // for local data
    expect2: expectMerged,
  },
  {
    beforeInstantiation: ["resolveBackendData"],
    beforeRestore1: ["resolveCompression", "resolveDecompression"],
    afterRestore1: [],
    expect1: expectMerged,
    beforeRestore2: ["resolveDecompression"],
    expect2: expectMerged,
  },
  {
    beforeInstantiation: ["resolveBackendData"],
    beforeRestore1: [
      "resolveCompression",
      "resolveCompression",
      "resolveDecompression",
      "resolveDecompression",
    ],
    afterRestore1: [],
    expect1: expectMerged,
    // For the second read, local and backend data need to be decompressed
    // again.
    beforeRestore2: ["resolveDecompression", "resolveDecompression"],
    expect2: expectMerged,
  },
  {
    beforeInstantiation: [],
    beforeRestore1: ["resolveCompression", "resolveBackendData", "resolveDecompression"],
    afterRestore1: [],
    expect1: expectMerged,
    beforeRestore2: ["resolveDecompression"],
    expect2: expectMerged,
  },
  {
    beforeInstantiation: [],
    beforeRestore1: [
      "resolveCompression",
      "resolveBackendData",
      "resolveCompression",
      "resolveDecompression",
      "resolveDecompression",
    ],
    afterRestore1: [],
    expect1: expectMerged,
    beforeRestore2: ["resolveDecompression", "resolveDecompression"],
    expect2: expectMerged,
  },
];

describe("BucketSnapshot", () => {
  for (const [idx, plan] of plans.entries()) {
    it(`BucketSnapshot with unmerged state should retrieve merged data (${idx + 1})`, async () => {
      const mockCompressor = new MockCompressor();
      const maybeUnmergedBucketLoadedDeferred = new Deferred<void, void>();

      const planExecutor = new PlanExecutor(
        plan,
        mockCompressor,
        maybeUnmergedBucketLoadedDeferred,
      );

      const localData = new Uint8Array(8);
      const pendingOperations: PendingOperation[] = [
        (data) => {
          data[1] = 1;
          data[3] = 4;
        },
      ];
      pendingOperations.forEach((fn) => fn(localData));

      const backendData = new Uint8Array(8);
      backendData[3] = 3;
      backendData[4] = 4;
      backendData[5] = 5;

      await planExecutor.executeStep("beforeInstantiation");

      const snapshot = new BucketSnapshot(
        [0, 0, 0, 0],
        new Uint8Array(localData),
        maybeUnmergedBucketLoadedDeferred.promise().then(() => backendData),
        pendingOperations,
        "tracingId",
        "uint8",
        mockCompressor,
      );
      await planExecutor.executeStep("beforeRestore1");

      const { newData, newPendingOperations, needsMergeWithBackendData } =
        await snapshot.getDataForRestore();

      await planExecutor.executeStep("afterRestore1");

      plan.expect1({
        newPendingOperations,
        pendingOperations,
        needsMergeWithBackendData,
        newData,
        localData,
        backendData,
      });

      expect(newData[3]).toBe(4);
      await planExecutor.executeStep("beforeRestore2");

      {
        const { newData, newPendingOperations, needsMergeWithBackendData } =
          await snapshot.getDataForRestore();
        plan.expect2({
          newPendingOperations,
          pendingOperations,
          needsMergeWithBackendData,
          newData,
          localData,
          backendData,
        });
      }

      expect(mockCompressor.resolveCompressionCounter).toBe(0);
      expect(mockCompressor.resolveDecompressionCounter).toBe(0);
    });
  }
});
