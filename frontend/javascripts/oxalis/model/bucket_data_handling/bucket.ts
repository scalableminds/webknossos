import ErrorHandling from "libs/error_handling";
import { castForArrayType, mod } from "libs/utils";
import window from "libs/window";
import _ from "lodash";
import { type Emitter, createNanoEvents } from "nanoevents";
import type { BoundingBoxType, BucketAddress, Vector3 } from "oxalis/constants";
import Constants from "oxalis/constants";
import type { MaybeUnmergedBucketLoadedPromise } from "oxalis/model/actions/volumetracing_actions";
import { addBucketToUndoAction } from "oxalis/model/actions/volumetracing_actions";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import { PullQueueConstants } from "oxalis/model/bucket_data_handling/pullqueue";
import type TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import { bucketPositionToGlobalAddress } from "oxalis/model/helpers/position_converter";
import Store from "oxalis/store";
import * as THREE from "three";
import type { ElementClass } from "types/api_flow_types";
import type { AdditionalCoordinate } from "types/api_flow_types";
import { getActiveMagIndexForLayer } from "../accessors/flycam_accessor";

export enum BucketStateEnum {
  UNREQUESTED = "UNREQUESTED",
  REQUESTED = "REQUESTED",
  MISSING = "MISSING", // Missing means that the bucket couldn't be found on the data store
  LOADED = "LOADED",
}
export type BucketStateEnumType = keyof typeof BucketStateEnum;

// This type needs to be adapted when a new dtype should/element class needs
// to be supported.
export type BucketDataArray =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | BigUint64Array
  | BigInt64Array;

const WARNING_THROTTLE_THRESHOLD = 10000;

const warnMergeWithoutPendingOperations = _.throttle(() => {
  ErrorHandling.notify(
    new Error("Bucket.merge() was called with an empty list of pending operations."),
  );
}, WARNING_THROTTLE_THRESHOLD);

const warnAwaitedMissingBucket = _.throttle(() => {
  ErrorHandling.notify(new Error("Awaited missing bucket"));
}, WARNING_THROTTLE_THRESHOLD);

export function assertNonNullBucket(bucket: Bucket): asserts bucket is DataBucket {
  if (bucket.type === "null") {
    throw new Error("Unexpected null bucket.");
  }
}

export class NullBucket {
  type = "null" as const;

  hasData(): boolean {
    return false;
  }

  needsRequest(): boolean {
    return false;
  }

  getData(): BucketDataArray {
    throw new Error("NullBucket has no data.");
  }

  ensureLoaded(): Promise<void> {
    return Promise.resolve();
  }
}

export type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | BigInt64ArrayConstructor
  | BigUint64ArrayConstructor;

export const getConstructorForElementClass = (
  type: ElementClass,
): [TypedArrayConstructor, number] => {
  switch (type) {
    // This function needs to be adapted when a new dtype should/element class needs
    // to be supported.
    case "uint8":
      return [Uint8Array, 1];
    case "int8":
      return [Int8Array, 1];

    case "uint16":
      return [Uint16Array, 1];
    case "int16":
      return [Int16Array, 1];

    case "uint24":
      // There is no Uint24Array and uint24 is treated in a special way (rgb) anyways
      return [Uint8Array, 3];

    case "uint32":
      return [Uint32Array, 1];
    case "int32":
      return [Int32Array, 1];

    case "float":
      return [Float32Array, 1];

    case "uint64":
      return [BigUint64Array, 1];
    case "int64":
      return [BigInt64Array, 1];

    default:
      throw new Error(`This type is not supported by the DataBucket class: ${type}`);
  }
};
export const NULL_BUCKET = new NullBucket();
// The type is used within the DataBucket class which is why
// we have to define it here.
export type Bucket = DataBucket | NullBucket;
// This set saves whether a bucket is already added to the current undo volume batch
// and gets cleared when a volume transaction is ended (marked by the action
// FINISH_ANNOTATION_STROKE).
export const bucketsAlreadyInUndoState: Set<Bucket> = new Set();
export function markVolumeTransactionEnd() {
  bucketsAlreadyInUndoState.clear();
}

export class DataBucket {
  type = "data" as const;
  elementClass: ElementClass;
  visualizedMesh: Record<string, any> | null | undefined;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'visualizationColor' has no initializer a... Remove this comment to see the full error message
  visualizationColor: THREE.Color;
  // If dirty, the bucket's data was potentially edited and needs to be
  // saved to the server.
  dirty: boolean;
  // `dirtyCount` reflects how many pending snapshots of the bucket exist.
  // A pending snapshot is a snapshot which was either
  // - not yet saved (after successful saving the dirtyCount is decremented) or
  // - not yet created by the PushQueue, since the PushQueue creates the snapshots
  //   in a debounced manner
  dirtyCount: number = 0;
  pendingOperations: Array<(arg0: BucketDataArray) => void> = [];
  state: BucketStateEnumType;
  accessed: boolean;
  data: BucketDataArray | null | undefined;
  temporalBucketManager: TemporalBucketManager;
  zoomedAddress: BucketAddress;
  cube: DataCube;
  _fallbackBucket: Bucket | null | undefined;
  throttledTriggerLabeled: () => void;
  emitter: Emitter;
  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise;
  // Especially, for segmentation buckets, it can be interesting to
  // know whether a certain ID is contained in this bucket. To
  // speed up such requests a cached set of the contained values
  // can be stored in cachedValueSet.
  cachedValueSet: Set<number> | Set<bigint> | null = null;

  constructor(
    elementClass: ElementClass,
    zoomedAddress: BucketAddress,
    temporalBucketManager: TemporalBucketManager,
    cube: DataCube,
  ) {
    this.emitter = createNanoEvents();
    this.maybeUnmergedBucketLoadedPromise = null;
    this.elementClass = elementClass;
    this.cube = cube;
    this.zoomedAddress = zoomedAddress;
    this.temporalBucketManager = temporalBucketManager;
    this.state = BucketStateEnum.UNREQUESTED;
    this.dirty = false;
    this.accessed = false;
    this.data = null;

    if (this.cube.isSegmentation) {
      this.throttledTriggerLabeled = _.throttle(() => this.trigger("bucketLabeled"), 10);
    } else {
      this.throttledTriggerLabeled = _.noop;
    }
  }

  once(event: string, callback: (...args: any[]) => any): () => void {
    const unbind = this.emitter.on(event, (...args: any[]) => {
      unbind();
      callback(...args);
    });
    return unbind;
  }

  on(event: string, cb: (...args: any[]) => any): () => void {
    return this.emitter.on(event, cb);
  }

  trigger(event: string, ...args: any[]): void {
    this.emitter.emit(event, ...args);
  }

  getBoundingBox(): BoundingBoxType {
    const min = bucketPositionToGlobalAddress(this.zoomedAddress, this.cube.magInfo);
    const bucketMag = this.cube.magInfo.getMagByIndexOrThrow(this.zoomedAddress[3]);
    const max: Vector3 = [
      min[0] + Constants.BUCKET_WIDTH * bucketMag[0],
      min[1] + Constants.BUCKET_WIDTH * bucketMag[1],
      min[2] + Constants.BUCKET_WIDTH * bucketMag[2],
    ];
    return {
      min,
      max,
    };
  }

  getGlobalPosition(): Vector3 {
    return bucketPositionToGlobalAddress(this.zoomedAddress, this.cube.magInfo);
  }

  getTopLeftInMag(): Vector3 {
    return [
      this.zoomedAddress[0] * Constants.BUCKET_WIDTH,
      this.zoomedAddress[1] * Constants.BUCKET_WIDTH,
      this.zoomedAddress[2] * Constants.BUCKET_WIDTH,
    ];
  }

  shouldCollect(): boolean {
    const collect =
      !this.accessed &&
      !this.dirty &&
      this.state !== BucketStateEnum.REQUESTED &&
      this.dirtyCount === 0;
    return collect;
  }

  destroy(): void {
    // Since we rely on the GC to collect buckets, we
    // can easily have references to buckets which prohibit GC.
    // As a countermeasure, we set the data attribute to null
    // so that at least the big memory hog is tamed (unfortunately,
    // this doesn't help against references which point directly to this.data)
    this.data = null;
    this.invalidateValueSet();
    this.trigger("bucketCollected");
    // Remove all event handlers (see https://github.com/ai/nanoevents#remove-all-listeners)
    this.emitter.events = {};
  }

  needsRequest(): boolean {
    return this.state === BucketStateEnum.UNREQUESTED;
  }

  isRequested(): boolean {
    return this.state === BucketStateEnum.REQUESTED;
  }

  isLoaded(): boolean {
    return this.state === BucketStateEnum.LOADED;
  }

  isMissing(): boolean {
    return this.state === BucketStateEnum.MISSING;
  }

  needsBackendData(): boolean {
    /*
    "Needs backend data" means that the front-end has not received any data (nor "missing" reply) for this bucket, yet.
    The return value does
      - not tell whether the data fetching was already initiated (does not differentiate between UNREQUESTED and REQUESTED)
      - not tell whether the backend actually has data for the address (does not differentiate between LOADED and MISSING)
    */
    return this.state === BucketStateEnum.UNREQUESTED || this.state === BucketStateEnum.REQUESTED;
  }

  getAddress(): Vector3 {
    return [this.zoomedAddress[0], this.zoomedAddress[1], this.zoomedAddress[2]];
  }

  getAdditionalCoordinates(): AdditionalCoordinate[] | undefined | null {
    return this.zoomedAddress[4];
  }

  is3DVoxelInsideBucket = (voxel: Vector3, zoomStep: number) => {
    // Checks whether a given 3D voxel is outside of the bucket it refers to (i.e., a coordinate is negative
    // or greater than 32). If this is the case, the bucket address of the neighbor which contains the position
    // is also returned along with the adjusted voxel coordinate in that neighboring bucket.
    const neighbourBucketAddress: BucketAddress = [
      this.zoomedAddress[0],
      this.zoomedAddress[1],
      this.zoomedAddress[2],
      zoomStep,
      this.getAdditionalCoordinates() || [],
    ];
    let isVoxelOutside = false;
    const adjustedVoxel: Vector3 = [voxel[0], voxel[1], voxel[2]];

    for (const dimensionIndex of [0, 1, 2]) {
      if (voxel[dimensionIndex] < 0 || voxel[dimensionIndex] >= Constants.BUCKET_WIDTH) {
        isVoxelOutside = true;
        const sign = Math.sign(voxel[dimensionIndex]);
        const offset = Math.ceil(Math.abs(voxel[dimensionIndex]) / Constants.BUCKET_WIDTH);
        // If the voxel coordinate is below 0, sign is negative and will lower the neighbor
        // bucket address
        (neighbourBucketAddress[dimensionIndex] as number) += sign * offset;
      }

      adjustedVoxel[dimensionIndex] = mod(adjustedVoxel[dimensionIndex], Constants.BUCKET_WIDTH);
    }

    return {
      isVoxelOutside,
      neighbourBucketAddress,
      adjustedVoxel,
    };
  };

  getCopyOfData(): BucketDataArray {
    const bucketData = this.getOrCreateData();
    const TypedArrayClass = getConstructorForElementClass(this.elementClass)[0];
    const dataClone = new TypedArrayClass(bucketData);
    return dataClone;
  }

  async label_DEPRECATED(labelFunc: (arg0: BucketDataArray) => void): Promise<void> {
    /*
     * It's not recommended to use this method (repeatedly), as it can be
     * very slow. See the docstring for Bucket.getOrCreateData() for alternatives.
     */
    const bucketData = await this.getDataForMutation();
    this.startDataMutation();
    labelFunc(bucketData);
    this.endDataMutation();
  }

  _markAndAddBucketForUndo() {
    // This method adds a snapshot of the current bucket to the undo stack.
    // Note that the method may be called multiple times during a volume
    // transaction (e.g., when moving the brush over the same buckets for
    // multiple frames). Since a snapshot of the "old" data should be
    // saved to the undo stack, the snapshot only has to be created once
    // for each transaction.
    // This is ensured by checking bucketsAlreadyInUndoState.
    this.dirty = true;

    if (bucketsAlreadyInUndoState.has(this)) {
      return;
    }

    bucketsAlreadyInUndoState.add(this);
    const dataClone = this.getCopyOfData();

    if (this.needsBackendData() && this.maybeUnmergedBucketLoadedPromise == null) {
      this.maybeUnmergedBucketLoadedPromise = new Promise((resolve, _reject) => {
        this.once("unmergedBucketDataLoaded", (data) => {
          // Once the bucket was loaded, maybeUnmergedBucketLoadedPromise can be null'ed
          this.maybeUnmergedBucketLoadedPromise = null;
          resolve(data);
        });
      });
    }

    Store.dispatch(
      // Always use the current state of this.maybeUnmergedBucketLoadedPromise, since
      // this bucket could be added to multiple undo batches while it's fetched. All entries
      // need to have the corresponding promise for the undo to work correctly.
      addBucketToUndoAction(
        this.zoomedAddress,
        dataClone,
        this.maybeUnmergedBucketLoadedPromise,
        this.pendingOperations,
        this.getTracingId(),
      ),
    );
  }

  hasData(): boolean {
    return this.data != null;
  }

  getData(): BucketDataArray {
    const { data } = this;

    if (data == null) {
      throw new Error("Bucket.getData() called, but data does not exist (anymore).");
    }

    return data;
  }

  setData(newData: BucketDataArray, newPendingOperations: Array<(arg0: BucketDataArray) => void>) {
    this.data = newData;
    this.invalidateValueSet();
    this.pendingOperations = newPendingOperations;
    this.dirty = true;
    this.endDataMutation();
    this.cube.triggerBucketDataChanged();
  }

  uint8ToTypedBuffer(arrayBuffer: Uint8Array | null | undefined) {
    const [TypedArrayClass, channelCount] = getConstructorForElementClass(this.elementClass);
    return arrayBuffer != null
      ? new TypedArrayClass(
          arrayBuffer.buffer,
          arrayBuffer.byteOffset,
          arrayBuffer.byteLength / TypedArrayClass.BYTES_PER_ELEMENT,
        )
      : new TypedArrayClass(channelCount * Constants.BUCKET_SIZE);
  }

  markAsNeeded(): void {
    this.accessed = true;
  }

  markAsUnneeded(): void {
    this.accessed = false;
  }

  getOrCreateData(): BucketDataArray {
    /*
     * Don't use this method to get the bucket's data, if you want to mutate it.
     * Instead, use
     *   1) the preferred VoxelMap primitive (via applyVoxelMap) which works for not
     *      (yet) loaded buckets
     *   2) or the async method getDataForMutation(), which ensures that the bucket is
     *      loaded before mutation (therefore, no async merge operations have to be
     *      defined). See DataCube.floodFill() for an example usage of this pattern.
     */
    if (this.data == null) {
      const [TypedArrayClass, channelCount] = getConstructorForElementClass(this.elementClass);
      this.data = new TypedArrayClass(channelCount * Constants.BUCKET_SIZE);

      if (!this.isMissing()) {
        this.temporalBucketManager.addBucket(this);
      }
    }

    return this.getData();
  }

  async getDataForMutation(): Promise<BucketDataArray> {
    /*
     * You can use the returned data to inspect it. If you decide to mutate the data,
     * please call startDataMutation() before the mutation and endDataMutation() afterwards.
     * Example:
     *
     * const data = await bucket.getDataForMutation();
     * bucket.startDataMutation();
     * data[...] = ...;
     * bucket.endDataMutation();
     */
    await this.ensureLoaded();
    return this.getOrCreateData();
  }

  startDataMutation(): void {
    /*
     * See Bucket.getDataForMutation() for a safe way of using this method.
     */
    this._markAndAddBucketForUndo();
  }

  endDataMutation(): void {
    /*
     * See Bucket.getDataForMutation() for a safe way of using this method.
     */
    this.cube.pushQueue.insert(this);
    this.trigger("bucketLabeled");
  }

  applyVoxelMap(
    voxelMap: Uint8Array,
    segmentId: number,
    get3DAddress: (arg0: number, arg1: number, arg2: Vector3 | Float32Array) => void,
    sliceCount: number,
    thirdDimensionIndex: 0 | 1 | 2, // If shouldOverwrite is false, a voxel is only overwritten if
    // its old value is equal to overwritableValue.
    shouldOverwrite: boolean = true,
    overwritableValue: number = 0,
  ): boolean {
    const data = this.getOrCreateData();

    if (this.needsBackendData()) {
      // If the frontend does not yet have the backend's data
      // for this bucket, we apply the voxel map, but also
      // save it in this.pendingOperations. See Bucket.merge()
      // for more details.
      this.pendingOperations.push((_data) =>
        this._applyVoxelMapInPlace(
          _data,
          voxelMap,
          segmentId,
          get3DAddress,
          sliceCount,
          thirdDimensionIndex,
          shouldOverwrite,
          overwritableValue,
        ),
      );
    }

    return this._applyVoxelMapInPlace(
      data,
      voxelMap,
      segmentId,
      get3DAddress,
      sliceCount,
      thirdDimensionIndex,
      shouldOverwrite,
      overwritableValue,
    );
  }

  _applyVoxelMapInPlace(
    data: BucketDataArray,
    voxelMap: Uint8Array,
    uncastSegmentId: number,
    get3DAddress: (arg0: number, arg1: number, arg2: Vector3 | Float32Array) => void,
    sliceCount: number,
    thirdDimensionIndex: 0 | 1 | 2, // If shouldOverwrite is false, a voxel is only overwritten if
    // its old value is equal to overwritableValue.
    shouldOverwrite: boolean = true,
    overwritableValue: number = 0,
  ): boolean {
    const out = new Float32Array(3);
    let wroteVoxels = false;

    const segmentId = castForArrayType(uncastSegmentId, data);

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        if (voxelMap[firstDim * Constants.BUCKET_WIDTH + secondDim] === 1) {
          get3DAddress(firstDim, secondDim, out);
          const voxelToLabel = out;
          voxelToLabel[thirdDimensionIndex] =
            (voxelToLabel[thirdDimensionIndex] + sliceCount) % Constants.BUCKET_WIDTH;
          // The voxelToLabel is already within the bucket and in the correct magnification.
          const voxelAddress = this.cube.getVoxelIndexByVoxelOffset(voxelToLabel);
          const currentSegmentId = Number(data[voxelAddress]);

          if (shouldOverwrite || (!shouldOverwrite && currentSegmentId === overwritableValue)) {
            data[voxelAddress] = segmentId;
            wroteVoxels = true;
          }
        }
      }
    }

    this.invalidateValueSet();

    return wroteVoxels;
  }

  markAsPulled(): void {
    switch (this.state) {
      case BucketStateEnum.UNREQUESTED: {
        this.state = BucketStateEnum.REQUESTED;
        break;
      }

      default:
        this.unexpectedState();
    }
  }

  markAsFailed(isMissing: boolean): void {
    switch (this.state) {
      case BucketStateEnum.REQUESTED: {
        this.state = isMissing ? BucketStateEnum.MISSING : BucketStateEnum.UNREQUESTED;

        if (isMissing) {
          this.trigger("bucketMissing");
        }

        break;
      }

      default:
        this.unexpectedState();
    }
  }

  receiveData(arrayBuffer: Uint8Array | null | undefined, computeValueSet: boolean = false): void {
    const data = this.uint8ToTypedBuffer(arrayBuffer);
    const [TypedArrayClass, channelCount] = getConstructorForElementClass(this.elementClass);

    if (data.length !== channelCount * Constants.BUCKET_SIZE) {
      const debugInfo = // Disable this conditional if you need verbose output here.
        process.env.IS_TESTING
          ? " (<omitted>)"
          : {
              arrayBuffer,
              actual: data.length,
              expected: channelCount * Constants.BUCKET_SIZE,
              channelCount,
            };
      console.warn("bucket.data has unexpected length", debugInfo);
      ErrorHandling.notify(
        new Error(`bucket.data has unexpected length. Details: ${JSON.stringify(debugInfo)}`),
      );
    }

    switch (this.state) {
      case BucketStateEnum.REQUESTED: {
        if (this.dirty) {
          // Clone the data for the unmergedBucketDataLoaded event,
          // as the following merge operation is done in-place.
          const dataClone = new TypedArrayClass(data);
          this.trigger("unmergedBucketDataLoaded", dataClone);
          this.merge(data);
        } else {
          this.data = data;
        }
        this.invalidateValueSet();
        if (computeValueSet) {
          this.ensureValueSet();
        }

        this.state = BucketStateEnum.LOADED;
        this.trigger("bucketLoaded", data);
        this.cube.triggerBucketDataChanged();
        break;
      }

      default:
        this.unexpectedState();
    }
  }

  private invalidateValueSet() {
    this.cachedValueSet = null;
  }

  private ensureValueSet(): asserts this is { cachedValueSet: Set<number> | Set<bigint> } {
    if (this.cachedValueSet == null) {
      // @ts-ignore The Set constructor accepts null and BigUint64Arrays just fine.
      this.cachedValueSet = new Set(this.data);
    }
  }

  containsValue(value: number | bigint): boolean {
    this.ensureValueSet();
    // @ts-ignore The Set has function accepts number | bigint values just fine, regardless of what's in it.
    return this.cachedValueSet.has(value);
  }

  getValueSet(): Set<number> | Set<bigint> {
    this.ensureValueSet();
    return this.cachedValueSet;
  }

  markAsPushed(): void {
    switch (this.state) {
      case BucketStateEnum.LOADED:
      case BucketStateEnum.MISSING: {
        this.dirty = false;
        break;
      }

      default:
        this.unexpectedState();
    }
  }

  unexpectedState(): void {
    throw new Error(`Unexpected state: ${this.state}`);
  }

  getTracingId(): string {
    return this.cube.layerName;
  }

  merge(fetchedData: BucketDataArray): void {
    if (this.data == null) {
      throw new Error("Bucket.merge() called, but data does not exist.");
    }

    // The frontend just received the backend's data for this bucket.
    // We apply all pendingOperations on the backends data
    // and set it to this.data.
    // The old this.data is discarded/overwritten, since it was only
    // a preliminary version of the data.
    for (const op of this.pendingOperations) {
      op(fetchedData);
    }

    this.data = fetchedData;

    if (this.pendingOperations.length === 0) {
      // This can happen when mutating an unloaded bucket and then
      // undoing it. The bucket is still marked as dirty, even though
      // no pending operations are necessary (since the bucket was restored
      // to an untouched version).
      // See this refactoring issue: https://github.com/scalableminds/webknossos/issues/5973
      warnMergeWithoutPendingOperations();
    }

    this.pendingOperations = [];
  }

  // The following three methods can be used for debugging purposes.
  // The bucket will be rendered in the 3D scene as a wireframe geometry.
  visualize() {
    if (this.visualizedMesh != null) {
      return;
    }

    const colors = [
      new THREE.Color(0, 0, 0),
      new THREE.Color(255, 0, 0),
      new THREE.Color(0, 255, 0),
      new THREE.Color(0, 0, 255),
      new THREE.Color(255, 0, 255),
      new THREE.Color(255, 255, 0),
    ];

    const zoomStep = getActiveMagIndexForLayer(Store.getState(), this.cube.layerName);

    if (this.zoomedAddress[3] === zoomStep) {
      // @ts-ignore
      this.visualizedMesh = window.addBucketMesh(
        bucketPositionToGlobalAddress(this.zoomedAddress, this.cube.magInfo),
        this.zoomedAddress[3],
        this.cube.magInfo.getMagByIndex(this.zoomedAddress[3]),
        colors[this.zoomedAddress[3]] || this.visualizationColor,
      );
    }
  }

  unvisualize() {
    if (this.visualizedMesh != null) {
      // @ts-ignore
      window.removeBucketMesh(this.visualizedMesh);
      this.visualizedMesh = null;
    }
  }

  setVisualizationColor(colorDescriptor: string | number) {
    const color = new THREE.Color(colorDescriptor);
    this.visualizationColor = color;

    if (this.visualizedMesh != null) {
      this.visualizedMesh.material.color = color;
    }
  }

  // This is a debugging function to enable logging specific
  // to a certain bucket. When drilling down on a specific bucket
  // you can adapt the if-condition (e.g. for only printing logs
  // for a specific bucket address).
  //
  // Example usage:
  // bucket._logMaybe("Data of problematic bucket", bucket.data)
  _logMaybe = (...args: any[]) => {
    if (this.zoomedAddress.join(",") === [93, 0, 0, 0].join(",")) {
      console.log(...args);
    }
  };

  async ensureLoaded(): Promise<void> {
    let needsToAwaitBucket = false;

    if (this.isRequested()) {
      needsToAwaitBucket = true;
    } else if (this.needsRequest()) {
      this.cube.pullQueue.add({
        bucket: this.zoomedAddress,
        priority: PullQueueConstants.PRIORITY_HIGHEST,
      });
      this.cube.pullQueue.pull();
      needsToAwaitBucket = true;
    } else if (this.isMissing()) {
      // Awaiting is not necessary.
    }

    if (needsToAwaitBucket) {
      await new Promise((resolve) => {
        this.once("bucketLoaded", resolve);
        this.once("bucketMissing", resolve);
      });
    }

    // Bucket has been loaded by now or was loaded already
    if (this.isMissing()) {
      // In the past, ensureLoaded() never returned if the bucket
      // was MISSING. This log might help to discover potential
      // bugs which could arise in combination with MISSING buckets.
      warnAwaitedMissingBucket();
    }
  }
}
