/**
 * bucket.js
 * @flow
 */

import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
import _ from "lodash";

import {
  bucketPositionToGlobalAddress,
  zoomedAddressToAnotherZoomStep,
} from "oxalis/model/helpers/position_converter";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import DataCube from "oxalis/model/bucket_data_handling/data_cube";
import Store from "oxalis/store";
import TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import Constants, {
  type Vector2,
  type Vector3,
  type Vector4,
  type BoundingBoxType,
} from "oxalis/constants";
import type { DimensionMap } from "oxalis/model/dimensions";
import window from "libs/window";
import { type ElementClass } from "admin/api_flow_types";
import { addBucketToUndoAction } from "oxalis/model/actions/volumetracing_actions";

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

  state: BucketStateEnumType;
  dirty: boolean;
  accessed: boolean;
  data: ?BucketDataArray;
  temporalBucketManager: TemporalBucketManager;
  zoomedAddress: Vector4;
  // Copied from backbone events (TODO: handle this better)
  trigger: Function;
  on: Function;
  off: Function;
  once: Function;
  cube: DataCube;
  _fallbackBucket: ?Bucket;

  constructor(
    elementClass: ElementClass,
    zoomedAddress: Vector4,
    temporalBucketManager: TemporalBucketManager,
    cube: DataCube,
  ) {
    _.extend(this, BackboneEvents);
    this.elementClass = elementClass;
    this.cube = cube;
    this.zoomedAddress = zoomedAddress;
    this.temporalBucketManager = temporalBucketManager;

    this.state = BucketStateEnum.UNREQUESTED;
    this.dirty = false;
    this.accessed = false;

    this.data = null;
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

  shouldCollect(): boolean {
    const collect = !this.accessed && !this.dirty && this.state !== BucketStateEnum.REQUESTED;
    return collect;
  }

  destroy(): void {
    // Since we rely on the GC to collect buckets, we
    // can easily have references to buckets which prohibit GC.
    // As a countermeasure, we set the data attribute to null
    // so that at least the big memory hog is tamed (unfortunately,
    // this doesn't help against references which point directly to this.data)
    this.data = null;
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

  getAddress(): Vector3 {
    return [this.zoomedAddress[0], this.zoomedAddress[1], this.zoomedAddress[2]];
  }

  is2DVoxelInsideBucket = (voxel: Vector2, dimensionIndices: DimensionMap, zoomStep: number) => {
    const neighbourBucketAddress = [
      this.zoomedAddress[0],
      this.zoomedAddress[1],
      this.zoomedAddress[2],
      zoomStep,
    ];
    let isVoxelOutside = false;
    const adjustedVoxel = voxel;
    for (let dimensionIndex = 0; dimensionIndex < 2; ++dimensionIndex) {
      const dimension = dimensionIndices[dimensionIndex];
      if (voxel[dimensionIndex] < 0) {
        isVoxelOutside = true;
        const offset = Math.ceil(-voxel[dimensionIndex] / Constants.BUCKET_WIDTH);
        neighbourBucketAddress[dimension] -= offset;
        // Add a full bucket width to the coordinate below 0 to avoid error's
        // caused by the modulo operation used in getVoxelOffset.
        adjustedVoxel[dimensionIndex] += Constants.BUCKET_WIDTH * offset;
      } else if (voxel[dimensionIndex] >= Constants.BUCKET_WIDTH) {
        isVoxelOutside = true;
        const offset = Math.floor(voxel[dimensionIndex] / Constants.BUCKET_WIDTH);
        neighbourBucketAddress[dimension] += offset;
        adjustedVoxel[dimensionIndex] -= Constants.BUCKET_WIDTH * offset;
      }
    }
    return { isVoxelOutside, neighbourBucketAddress, adjustedVoxel };
  };

  getCopyOfData(): BucketDataArray {
    const bucketData = this.getOrCreateData();
    const TypedArrayClass = getConstructorForElementClass(this.elementClass)[0];
    const dataClone = new TypedArrayClass(bucketData);
    return dataClone;
  }

  label(labelFunc: BucketDataArray => void) {
    const bucketData = this.getOrCreateData();
    this.markAndAddBucketForUndo();
    labelFunc(bucketData);
    this.throttledTriggerLabeled();
  }

  throttledTriggerLabeled = _.throttle(() => this.trigger("bucketLabeled"), 10);

  markAndAddBucketForUndo() {
    this.dirty = true;
    if (!bucketsAlreadyInUndoState.has(this)) {
      bucketsAlreadyInUndoState.add(this);
      Store.dispatch(addBucketToUndoAction(this.zoomedAddress, this.getCopyOfData()));
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

  setData(newData: Uint8Array) {
    const TypedArrayClass = getConstructorForElementClass(this.elementClass)[0];
    this.data = new TypedArrayClass(
      newData.buffer,
      newData.byteOffset,
      newData.byteLength / TypedArrayClass.BYTES_PER_ELEMENT,
    );
    this.dirty = true;
    this.trigger("bucketLabeled");
  }

  markAsNeeded(): void {
    this.accessed = true;
  }

  markAsUnneeded(): void {
    this.accessed = false;
  }

  getOrCreateData(): BucketDataArray {
    if (this.data == null) {
      const [TypedArrayClass, channelCount] = getConstructorForElementClass(this.elementClass);
      this.data = new TypedArrayClass(channelCount * Constants.BUCKET_SIZE);
      if (!this.isMissing()) {
        this.temporalBucketManager.addBucket(this);
      }
    }

    return this.getData();
  }

  pull(): void {
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
    const [TypedArrayClass, channelCount] = getConstructorForElementClass(this.elementClass);
    const data =
      arrayBuffer != null
        ? new TypedArrayClass(
            arrayBuffer.buffer,
            arrayBuffer.byteOffset,
            arrayBuffer.byteLength / TypedArrayClass.BYTES_PER_ELEMENT,
          )
        : new TypedArrayClass(channelCount * Constants.BUCKET_SIZE);
    switch (this.state) {
      case BucketStateEnum.REQUESTED:
        if (this.dirty) {
          this.merge(data);
        } else {
          this.data = data;
        }
        this.trigger("bucketLoaded");
        this.state = BucketStateEnum.LOADED;
        break;
      default:
        this.unexpectedState();
    }
  }

  push(): void {
    switch (this.state) {
      case BucketStateEnum.LOADED:
        this.dirty = false;
        break;
      default:
        this.unexpectedState();
    }
  }

  unexpectedState(): void {
    throw new Error(`Unexpected state: ${this.state}`);
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

  merge(newData: BucketDataArray): void {
    if (this.data == null) {
      throw new Error("Bucket.merge() called, but data does not exist.");
    }

    for (let i = 0; i < Constants.BUCKET_SIZE; i++) {
      // Only overwrite with the new value if the old value was 0
      this.data[i] = this.data[i] || newData[i];
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
}
