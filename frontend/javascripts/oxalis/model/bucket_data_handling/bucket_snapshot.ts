import type { BucketAddress } from "oxalis/constants";
import type { MaybeUnmergedBucketLoadedPromise } from "oxalis/model/actions/volumetracing_actions";
import type { BucketDataArray, ElementClass } from "types/api_flow_types";
import { compressTypedArray, decompressToTypedArray } from "../helpers/bucket_compression";

export type PendingOperation = (arg0: BucketDataArray) => void;

export default class BucketSnapshot {
  readonly zoomedAddress: BucketAddress;
  readonly pendingOperations: PendingOperation[];
  readonly tracingId: string;
  readonly needsMergeWithBackendData: boolean;
  readonly elementClass: ElementClass;
  // The version at which the annotation was when the
  // snapshot was created.
  // todop: should it default to null?
  readonly version: number | null;

  // A copy of the bucket's data. Either stored
  // uncompressed:
  dataClone: BucketDataArray | null;
  // ... or compressed:
  compressedData: Uint8Array | null = null;

  // A pending promise of the unmerged backend data. Once the promise
  // is fulfilled, it will be set to null.
  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise;
  // Afterwards, the backend data is either stored
  // uncompressed:
  backendBucketData: BucketDataArray | null = null;
  // ... or compressed:
  compressedBackendData: Uint8Array | null = null;

  constructor(
    zoomedAddress: BucketAddress,
    dataClone: BucketDataArray,
    maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise,
    pendingOperations: PendingOperation[],
    tracingId: string,
    elementClass: ElementClass,
    version: number | null,
  ) {
    this.zoomedAddress = zoomedAddress;
    this.dataClone = dataClone;
    this.maybeUnmergedBucketLoadedPromise = maybeUnmergedBucketLoadedPromise;
    this.pendingOperations = pendingOperations;
    this.tracingId = tracingId;
    this.elementClass = elementClass;
    this.version = version;

    this.needsMergeWithBackendData = maybeUnmergedBucketLoadedPromise != null;

    this.startCompression();
  }

  private startCompression() {
    if (this.dataClone != null) {
      compressTypedArray(this.dataClone).then((compressedData) => {
        this.compressedData = compressedData;
        this.dataClone = null;
      });
    }
    if (this.maybeUnmergedBucketLoadedPromise == null) {
      return;
    }
    this.maybeUnmergedBucketLoadedPromise.then((backendBucketData) => {
      // Once the backend data is fetched, do not directly merge it with the local data
      // as this operation is only needed, when the volume action is undone. Additionally merging is more
      // expensive than saving the backend data. Thus the data is only merged when it is needed.
      this.backendBucketData = backendBucketData;
      this.maybeUnmergedBucketLoadedPromise = null;
      compressTypedArray(backendBucketData).then((compressedBackendData) => {
        this.backendBucketData = null;
        this.compressedBackendData = compressedBackendData;
      });
    });
  }

  private async getLocalData(): Promise<BucketDataArray> {
    if (this.dataClone != null) {
      return this.dataClone;
    }
    if (this.compressedData == null) {
      throw new Error("BucketSnapshot has neither data nor compressedData.");
    }
    return await decompressToTypedArray(this.compressedData, this.elementClass);
  }

  private isBackendDataAvailable() {
    return this.backendBucketData != null || this.compressedBackendData != null;
  }

  private async getBackendData(): Promise<BucketDataArray> {
    if (this.backendBucketData != null) {
      return this.backendBucketData;
    }
    if (this.compressedBackendData == null) {
      throw new Error("getBackendData was called even though no backend data exists.");
    }
    return await decompressToTypedArray(this.compressedBackendData, this.elementClass);
  }

  async getDataForRestore(): Promise<{
    newData: BucketDataArray;
    newPendingOperations: PendingOperation[];
  }> {
    // todop: clarify case with
    //        this.needsMergeWithBackendData && !isBackendDataAvailable...
    if (this.needsMergeWithBackendData && this.isBackendDataAvailable()) {
      const [decompressedBucketData, decompressedBackendData] = await Promise.all([
        this.getLocalData(),
        this.getBackendData(),
      ]);
      mergeDataWithBackendDataInPlace(
        decompressedBucketData,
        decompressedBackendData,
        this.pendingOperations,
      );
      return {
        newData: decompressedBucketData,
        newPendingOperations: [],
      };
    }

    // Either, no merge is necessary (e.g., because the snapshot was already
    // created with the merged data) or the backend data hasn't arrived yet.
    // In both cases, simply return the available data.
    // If back-end data needs to be merged, this will happen within Bucket.receiveData?
    const newData = await this.getLocalData();

    // todop: right after the above await, could it happen that the back-end data is now available?

    return {
      newData,
      newPendingOperations: this.pendingOperations,
    };
  }
}

function mergeDataWithBackendDataInPlace(
  originalData: BucketDataArray,
  backendData: BucketDataArray,
  pendingOperations: Array<(arg0: BucketDataArray) => void>,
) {
  if (originalData.length !== backendData.length) {
    throw new Error("Cannot merge data arrays with differing lengths");
  }

  // Transfer backend to originalData
  // The `set` operation is not problematic, since the BucketDataArray types
  // won't be mixed (either, they are BigInt or they aren't)
  // @ts-ignore
  originalData.set(backendData);

  for (const op of pendingOperations) {
    op(originalData);
  }
}
