/**
 * bucket.js
 * @flow
 */

import { createNanoEvents } from "nanoevents";
import * as THREE from "three";
import _ from "lodash";

import { type ElementClass } from "types/api_flow_types";
import { PullQueueConstants } from "oxalis/model/bucket_data_handling/pullqueue";
import {
  addBucketToUndoAction,
  type MaybeUnmergedBucketLoadedPromise,
} from "oxalis/model/actions/volumetracing_actions";
import {
  bucketPositionToGlobalAddress,
  zoomedAddressToAnotherZoomStep,
} from "oxalis/model/helpers/position_converter";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { mod } from "libs/utils";
import Constants, { type BoundingBoxType, type Vector3, type Vector4 } from "oxalis/constants";
import DataCube from "oxalis/model/bucket_data_handling/data_cube";
import ErrorHandling from "libs/error_handling";
import Store from "oxalis/store";
import TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import window from "libs/window";

export const BucketStateEnum = {
  UNREQUESTED: "UNREQUESTED",
  REQUESTED: "REQUESTED",
  MISSING: "MISSING", // Missing means that the bucket couldn't be found on the data store
  LOADED: "LOADED",
};
export type BucketStateEnumType = $Keys<typeof BucketStateEnum>;
export type BucketDataArray = Uint8Array | Uint16Array | Uint32Array | Float32Array;

export const bucketDebuggingFlags = {
  // For visualizing buckets which are passed to the GPU
  visualizeBucketsOnGPU: false,
  // For visualizing buckets which are prefetched
  visualizePrefetchedBuckets: false,
  // For enforcing fallback rendering. enforcedZoomDiff == 2, means
  // that buckets of currentZoomStep + 2 are rendered.
  enforcedZoomDiff: undefined,
};
// Exposing this variable allows debugging on deployed systems
window.bucketDebuggingFlags = bucketDebuggingFlags;

type Emitter = {
  on: Function,
  events: Object,
  emit: Function,
};

const WARNING_THROTTLE_THRESHOLD = 10000;
const warnMergeWithoutPendingOperations = _.throttle(() => {
  ErrorHandling.notify(
    new Error("Bucket.merge() was called with an empty list of pending operations."),
  );
}, WARNING_THROTTLE_THRESHOLD);

export class NullBucket {
  type: "null" = "null";
  isOutOfBoundingBox: boolean;

  constructor(isOutOfBoundingBox: boolean) {
    this.isOutOfBoundingBox = isOutOfBoundingBox;
  }

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

export const getConstructorForElementClass = (type: ElementClass) => {
  switch (type) {
    case "int8":
    case "uint8":
      return [Uint8Array, 1];
    case "int16":
    case "uint16":
      return [Uint16Array, 1];
    case "uint24":
      // There is no Uint24Array and uint24 is treated in a special way (rgb) anyways
      return [Uint8Array, 3];
    case "int32":
    case "uint32":
      return [Uint32Array, 1];
    case "float":
      return [Float32Array, 1];
    default:
      throw new Error(`This type is not supported by the DataBucket class: ${type}`);
  }
};

export const NULL_BUCKET = new NullBucket(false);
export const NULL_BUCKET_OUT_OF_BB = new NullBucket(true);

// The type is used within the DataBucket class which is why
// we have to define it here.
// eslint-disable-next-line no-use-before-define
export type Bucket = DataBucket | NullBucket;

// This set saves whether a bucket is already added to the current undo volume batch
// and gets cleared when a volume transaction is ended (marked by the action
// FINISH_ANNOTATION_STROKE).
export const bucketsAlreadyInUndoState: Set<Bucket> = new Set();

export function markVolumeTransactionEnd() {
  bucketsAlreadyInUndoState.clear();
}

export class DataBucket {
  type: "data" = "data";
  elementClass: ElementClass;
  visualizedMesh: ?Object;
  visualizationColor: number;
  dirtyCount: number = 0;
  pendingOperations: Array<(BucketDataArray) => void> = [];

  state: BucketStateEnumType;
  dirty: boolean;
  accessed: boolean;
  data: ?BucketDataArray;
  temporalBucketManager: TemporalBucketManager;
  zoomedAddress: Vector4;
  cube: DataCube;
  _fallbackBucket: ?Bucket;
  throttledTriggerLabeled: () => void;
  emitter: Emitter;
  maybeUnmergedBucketLoadedPromise: MaybeUnmergedBucketLoadedPromise;

  constructor(
    elementClass: ElementClass,
    zoomedAddress: Vector4,
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

  once(event: string, callback: Function): () => void {
    const unbind = this.emitter.on(event, (...args) => {
      unbind();
      callback(...args);
    });
    return unbind;
  }

  on(event: string, cb: Function): () => void {
    return this.emitter.on(event, cb);
  }

  trigger(event: string, ...args: Array<any>): void {
    this.emitter.emit(event, ...args);
  }

  getBoundingBox(): BoundingBoxType {
    const resolutions = getResolutions(Store.getState().dataset);
    const min = bucketPositionToGlobalAddress(this.zoomedAddress, resolutions);
    const bucketResolution = resolutions[this.zoomedAddress[3]];
    const max = [
      min[0] + Constants.BUCKET_WIDTH * bucketResolution[0],
      min[1] + Constants.BUCKET_WIDTH * bucketResolution[1],
      min[2] + Constants.BUCKET_WIDTH * bucketResolution[2],
    ];
    return { min, max };
  }

  getGlobalPosition(): Vector3 {
    const resolutions = getResolutions(Store.getState().dataset);
    return bucketPositionToGlobalAddress(this.zoomedAddress, resolutions);
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

  is3DVoxelInsideBucket = (voxel: Vector3, zoomStep: number) => {
    // Checks whether a given 3D voxel is outside of the bucket it refers to (i.e., a coordinate is negative
    // or greater than 32). If this is the case, the bucket address of the neighbor which contains the position
    // is also returned along with the adjusted voxel coordinate in that neighboring bucket.

    const neighbourBucketAddress = [
      this.zoomedAddress[0],
      this.zoomedAddress[1],
      this.zoomedAddress[2],
      zoomStep,
    ];
    let isVoxelOutside = false;
    const adjustedVoxel = [voxel[0], voxel[1], voxel[2]];
    for (const dimensionIndex of [0, 1, 2]) {
      if (voxel[dimensionIndex] < 0 || voxel[dimensionIndex] >= Constants.BUCKET_WIDTH) {
        isVoxelOutside = true;
        const sign = Math.sign(voxel[dimensionIndex]);
        const offset = Math.ceil(Math.abs(voxel[dimensionIndex]) / Constants.BUCKET_WIDTH);
        // If the voxel coordinate is below 0, sign is negative and will lower the neighbor
        // bucket address
        neighbourBucketAddress[dimensionIndex] += sign * offset;
      }
      adjustedVoxel[dimensionIndex] = mod(adjustedVoxel[dimensionIndex], Constants.BUCKET_WIDTH);
    }
    return { isVoxelOutside, neighbourBucketAddress, adjustedVoxel };
  };

  getCopyOfData(): BucketDataArray {
    const bucketData = this.getOrCreateData();
    const TypedArrayClass = getConstructorForElementClass(this.elementClass)[0];
    const dataClone = new TypedArrayClass(bucketData);
    return dataClone;
  }

  // eslint-disable-next-line camelcase
  async label_DEPRECATED(labelFunc: BucketDataArray => void): Promise<void> {
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
        this.once("unmergedBucketDataLoaded", data => {
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

  setData(newData: BucketDataArray) {
    this.data = newData;
    this.dirty = true;
    this.trigger("bucketLabeled");
  }

  uint8ToTypedBuffer(arrayBuffer: ?Uint8Array) {
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
    cellId: number,
    get3DAddress: (number, number, Vector3 | Float32Array) => void,
    sliceCount: number,
    thirdDimensionIndex: 0 | 1 | 2,
    // If shouldOverwrite is false, a voxel is only overwritten if
    // its old value is equal to overwritableValue.
    shouldOverwrite: boolean = true,
    overwritableValue: number = 0,
  ) {
    const data = this.getOrCreateData();

    if (this.needsBackendData()) {
      // If the frontend does not yet have the backend's data
      // for this bucket, we apply the voxel map, but also
      // save it in this.pendingOperations. See Bucket.merge()
      // for more details.
      this.pendingOperations.push(_data =>
        this._applyVoxelMapInPlace(
          _data,
          voxelMap,
          cellId,
          get3DAddress,
          sliceCount,
          thirdDimensionIndex,
          shouldOverwrite,
          overwritableValue,
        ),
      );
    }

    this._applyVoxelMapInPlace(
      data,
      voxelMap,
      cellId,
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
    cellId: number,
    get3DAddress: (number, number, Vector3 | Float32Array) => void,
    sliceCount: number,
    thirdDimensionIndex: 0 | 1 | 2,
    // If shouldOverwrite is false, a voxel is only overwritten if
    // its old value is equal to overwritableValue.
    shouldOverwrite: boolean = true,
    overwritableValue: number = 0,
  ) {
    const out = new Float32Array(3);
    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        if (voxelMap[firstDim * Constants.BUCKET_WIDTH + secondDim] === 1) {
          get3DAddress(firstDim, secondDim, out);
          const voxelToLabel = out;
          voxelToLabel[thirdDimensionIndex] =
            (voxelToLabel[thirdDimensionIndex] + sliceCount) % Constants.BUCKET_WIDTH;
          // The voxelToLabel is already within the bucket and in the correct resolution.
          const voxelAddress = this.cube.getVoxelIndexByVoxelOffset(voxelToLabel);
          const currentSegmentId = data[voxelAddress];
          if (shouldOverwrite || (!shouldOverwrite && currentSegmentId === overwritableValue)) {
            data[voxelAddress] = cellId;
          }
        }
      }
    }
  }

  markAsPulled(): void {
    switch (this.state) {
      case BucketStateEnum.UNREQUESTED:
        this.state = BucketStateEnum.REQUESTED;
        break;
      default:
        this.unexpectedState();
    }
  }

  markAsFailed(isMissing: boolean): void {
    switch (this.state) {
      case BucketStateEnum.REQUESTED:
        this.state = isMissing ? BucketStateEnum.MISSING : BucketStateEnum.UNREQUESTED;
        if (isMissing) {
          this.trigger("bucketMissing");
        }
        break;
      default:
        this.unexpectedState();
    }
  }

  receiveData(arrayBuffer: ?Uint8Array): void {
    const data = this.uint8ToTypedBuffer(arrayBuffer);
    const [TypedArrayClass, channelCount] = getConstructorForElementClass(this.elementClass);

    if (data.length !== channelCount * Constants.BUCKET_SIZE) {
      const debugInfo =
        // Disable this conditional if you need verbose output here.
        process.env.BABEL_ENV === "test"
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
        // Clone the data for the unmergedBucketDataLoaded event,
        // as the following merge operation is done in-place.
        const dataClone = new TypedArrayClass(data);
        this.trigger("unmergedBucketDataLoaded", dataClone);

        if (this.dirty) {
          this.merge(data);
        } else {
          this.data = data;
        }
        this.state = BucketStateEnum.LOADED;
        this.trigger("bucketLoaded", data);
        break;
      }
      default:
        this.unexpectedState();
    }
  }

  markAsPushed(): void {
    switch (this.state) {
      case BucketStateEnum.LOADED:
      case BucketStateEnum.MISSING:
        this.dirty = false;
        break;
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

  getFallbackBucket(): Bucket {
    if (this._fallbackBucket != null) {
      return this._fallbackBucket;
    }
    const zoomStep = this.zoomedAddress[3];
    const fallbackZoomStep = zoomStep + 1;
    const resolutions = getResolutions(Store.getState().dataset);

    if (fallbackZoomStep >= resolutions.length) {
      this._fallbackBucket = NULL_BUCKET;
      return NULL_BUCKET;
    }

    const fallbackBucketAddress = zoomedAddressToAnotherZoomStep(
      this.zoomedAddress,
      resolutions,
      fallbackZoomStep,
    );
    const fallbackBucket = this.cube.getOrCreateBucket(fallbackBucketAddress);

    this._fallbackBucket = fallbackBucket;
    if (fallbackBucket.type !== "null") {
      fallbackBucket.once("bucketCollected", () => {
        this._fallbackBucket = null;
      });
    }

    return fallbackBucket;
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
      // undoing it. The bucket is still marked as dirty, even though,
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
    const zoomStep = getRequestLogZoomStep(Store.getState());
    if (this.zoomedAddress[3] === zoomStep) {
      const resolutions = getResolutions(Store.getState().dataset);
      this.visualizedMesh = window.addBucketMesh(
        bucketPositionToGlobalAddress(this.zoomedAddress, resolutions),
        this.zoomedAddress[3],
        this.visualizationColor,
      );
    }
  }

  unvisualize() {
    if (this.visualizedMesh != null) {
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
  _logMaybe = (...args) => {
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
    }
    if (needsToAwaitBucket) {
      await new Promise(resolve => {
        this.once("bucketLoaded", resolve);
      });
    }
    // Bucket has been loaded by now or was loaded already
  }
}
