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
  type MaybeBucketLoadedPromise,
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
// and gets cleared by the save saga after an annotation step has finished.
export const bucketsAlreadyInUndoState: Set<Bucket> = new Set();

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
  maybeBucketLoadedPromise: MaybeBucketLoadedPromise;

  constructor(
    elementClass: ElementClass,
    zoomedAddress: Vector4,
    temporalBucketManager: TemporalBucketManager,
    cube: DataCube,
  ) {
    this.emitter = createNanoEvents();
    this.maybeBucketLoadedPromise = null;

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

  isUnsynced(): boolean {
    /*
    Unsynced means that the front-end has not received any data for this bucket, yet.
    The return value does
      - not tell whether the data fetching was already initiated (does not differentiate between UNREQUESTED and REQUESTED)
      - not tell whether the backend has data for the address (does not differentiate between LOADED and MISSING)
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

  getCopyOfData(): { dataClone: BucketDataArray } {
    const { data: bucketData } = this.getOrCreateData();
    const TypedArrayClass = getConstructorForElementClass(this.elementClass)[0];
    const dataClone = new TypedArrayClass(bucketData);
    return { dataClone };
  }

  label(labelFunc: BucketDataArray => void) {
    const { data: bucketData } = this.getOrCreateData();
    this.markAndAddBucketForUndo();
    labelFunc(bucketData);
    this.throttledTriggerLabeled();
  }

  markAndAddBucketForUndo() {
    this.dirty = true;
    if (!bucketsAlreadyInUndoState.has(this)) {
      bucketsAlreadyInUndoState.add(this);
      const { dataClone } = this.getCopyOfData();
      if (this.isUnsynced() && this.maybeBucketLoadedPromise == null) {
        this.maybeBucketLoadedPromise = new Promise((resolve, _reject) => {
          this.once("unmergedBucketDataLoaded", data => {
            this.logMaybe("unmergedBucketDataLoaded event");
            // Once the bucket was loaded, maybeBucketLoadedPromise can be null'ed
            this.maybeBucketLoadedPromise = null;
            resolve(data);
          });
        });
      }
      Store.dispatch(
        // Always use the current state of this.maybeBucketLoadedPromise, since
        // this bucket could be added to multiple undo batches while it's fetched. All entries
        // need to have the corresponding promise for the undo to work correctly.
        addBucketToUndoAction(
          this.zoomedAddress,
          dataClone,
          this.maybeBucketLoadedPromise,
          this.pendingOperations,
          this.getTracingId(),
        ),
      );
    }
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

  getOrCreateData(): { data: BucketDataArray } {
    if (this.data == null) {
      const [TypedArrayClass, channelCount] = getConstructorForElementClass(this.elementClass);
      this.data = new TypedArrayClass(channelCount * Constants.BUCKET_SIZE);
      if (!this.isMissing()) {
        this.temporalBucketManager.addBucket(this);
      }
    }
    return { data: this.getData() };
  }

  applyVoxelMap(
    voxelMap: Uint8Array,
    cellId: number,
    get3DAddress: (number, number, Vector3 | Float32Array) => void,
    sliceCount: number,
    thirdDimensionIndex: 0 | 1 | 2,
    // if shouldOverwrite is false, a voxel is only overwritten if
    // its old value is equal to overwritableValue.
    shouldOverwrite: boolean = true,
    overwritableValue: number = 0,
  ) {
    const { data } = this.getOrCreateData();

    if (this.isUnsynced()) {
      this.pendingOperations.push(data =>
        this._applyVoxelMapInPlace(
          data,
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
    // if shouldOverwrite is false, a voxel is only overwritten if
    // its old value is equal to overwritableValue.
    shouldOverwrite: boolean = true,
    overwritableValue: number = 0,
  ) {
    this.logMaybe("_applyVoxelMapInPlace", { cellId, shouldOverwrite, overwritableValue });
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
    const [, channelCount] = getConstructorForElementClass(this.elementClass);

    this.logMaybe("receiveData for", this.zoomedAddress);
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
      case BucketStateEnum.REQUESTED:
        const TypedArrayClass = getConstructorForElementClass(this.elementClass)[0];
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

  logMaybe = (...args) => {
    if (this.zoomedAddress.join(",") === [0, 0, 0, 0].join(",")) {
      debugger;
      console.log(...args);
    }
  };

  merge(fetchedData: BucketDataArray): void {
    if (this.data == null) {
      throw new Error("Bucket.merge() called, but data does not exist.");
    }

    if (this.pendingOperations.length > 0) {
      this.logMaybe("merge: new with pendingOperations");
      for (const op of this.pendingOperations) {
        op(fetchedData);
      }
      this.data = fetchedData;
      this.pendingOperations = [];
    } else {
      // this.logMaybe("merge: old approach");
      // // todo: this is a dummy heuristic. ideally everything should be handled
      // // via the pendingOperations.
      // for (let i = 0; i < Constants.BUCKET_SIZE; i++) {
      //   // Only overwrite with the new value if the old value was 0
      //   this.data[i] = this.data[i] || fetchedData[i];
      // }
    }
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
