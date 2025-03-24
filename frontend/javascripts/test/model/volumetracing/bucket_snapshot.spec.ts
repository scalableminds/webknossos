import test, { type ExecutionContext } from "ava";
import "test/mocks/lz4";
import BucketSnapshot, {
  type PendingOperation,
} from "oxalis/model/bucket_data_handling/bucket_snapshot";
import Deferred from "libs/async/deferred";
import type { BucketDataArray, ElementClass } from "types/api_flow_types";
import { uint8ToTypedBuffer } from "oxalis/model/helpers/typed_buffer";
import { sleep } from "libs/utils";

class MockCompressor {
  public compressionQueue: Array<Deferred<void, void>> = [];
  public decompressionQueue: Array<Deferred<void, void>> = [];

  resolveCompressionCounter: number = 0;
  resolveDecompressionCounter: number = 0;

  async compressTypedArray(bucketData: BucketDataArray): Promise<Uint8Array> {
    const deferred = new Deferred<void, void>();
    this.compressionQueue.push(deferred);
    this.updateQueues();
    await deferred.promise();
    return new Uint8Array(bucketData);
  }

  async decompressToTypedArray(
    compressedData: Uint8Array,
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
    private plan: { start: string[]; middle: string[]; end: string[] },
    private mockCompressor: MockCompressor,
    private backendDeferred: Deferred<void, void> | undefined,
  ) {}

  async executeStep(step: "start" | "middle" | "end") {
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
    } else if (action === "sleepTick") {
      await sleep(0);
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

const expectUnmerged = (t: ExecutionContext<unknown>, p: ExpectParams) => {
  t.deepEqual(p.newPendingOperations, p.pendingOperations);
  t.true(p.needsMergeWithBackendData);
  t.deepEqual(p.newData, p.localData);
};

const expectMerged = (t: ExecutionContext<unknown>, p: ExpectParams) => {
  t.deepEqual(p.newPendingOperations, []);
  t.false(p.needsMergeWithBackendData);

  const mergedData = p.backendData || p.localData;
  for (const fn of p.pendingOperations) {
    fn(mergedData);
  }

  t.deepEqual(p.newData, mergedData);
};

const plans = [
  {
    start: [],
    middle: [],
    end: [],
    expect: expectUnmerged,
  },
  {
    start: ["resolveBackendData"],
    middle: [],
    end: [],
    expect: expectMerged,
  },
  {
    start: [],
    middle: ["resolveCompression", "resolveDecompression"],
    end: ["resolveBackendData"],
    expect: expectUnmerged,
  },
  {
    start: ["resolveBackendData"],
    middle: ["resolveCompression", "resolveDecompression"],
    end: [],
    expect: expectMerged,
  },
  {
    start: ["resolveBackendData"],
    middle: [
      "resolveCompression",
      "resolveCompression",
      "resolveDecompression",
      "resolveDecompression",
    ],
    end: [],
    expect: expectMerged,
  },
  {
    start: [],
    middle: ["resolveCompression", "resolveBackendData", "resolveDecompression"],
    end: [],
    expect: expectMerged,
  },
  {
    start: [],
    middle: [
      "resolveCompression",
      "resolveBackendData",
      "resolveCompression",
      "resolveDecompression",
      "resolveDecompression",
    ],
    end: [],
    expect: expectMerged,
  },
];

for (const [idx, plan] of plans.entries()) {
  test(`BucketSnapshot with unmerged state should retrieve merged data (${idx + 1})`, async (t) => {
    const mockCompressor = new MockCompressor();
    const maybeUnmergedBucketLoadedDeferred = new Deferred<void, void>();

    const planExecutor = new PlanExecutor(plan, mockCompressor, maybeUnmergedBucketLoadedDeferred);

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

    planExecutor.executeStep("start");

    const snapshot = new BucketSnapshot(
      [0, 0, 0, 0],
      new Uint8Array(localData),
      maybeUnmergedBucketLoadedDeferred.promise().then(() => backendData),
      pendingOperations,
      "tracingId",
      "uint8",
      mockCompressor,
    );
    await planExecutor.executeStep("middle");

    const { newData, newPendingOperations, needsMergeWithBackendData } =
      await snapshot.getDataForRestore();

    await planExecutor.executeStep("end");

    plan.expect(t, {
      newPendingOperations,
      pendingOperations,
      needsMergeWithBackendData,
      newData,
      localData,
      backendData,
    });
    t.is(newData[3], 4);

    t.is(mockCompressor.resolveCompressionCounter, 0);
    t.is(mockCompressor.resolveDecompressionCounter, 0);
  });
}
