import { createNanoEvents, type Emitter } from "nanoevents";
import * as THREE from "three";
import _ from "lodash";
import type { BucketDataArray, ElementClass } from "types/api_flow_types";
import { PullQueueConstants } from "oxalis/model/bucket_data_handling/pullqueue";
import type { MaybeUnmergedBucketLoadedPromise } from "oxalis/model/actions/volumetracing_actions";
import { addBucketToUndoAction } from "oxalis/model/actions/volumetracing_actions";
import { bucketPositionToGlobalAddress } from "oxalis/model/helpers/position_converter";
import { castForArrayType, mod } from "libs/utils";
import type { BoundingBoxType, BucketAddress, Vector3 } from "oxalis/constants";
import Constants from "oxalis/constants";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import ErrorHandling from "libs/error_handling";
import Store from "oxalis/store";
import type TemporalBucketManager from "oxalis/model/bucket_data_handling/temporal_bucket_manager";
import window from "libs/window";
import { getActiveMagIndexForLayer } from "../accessors/flycam_accessor";
import type { AdditionalCoordinate } from "types/api_flow_types";
import BucketSnapshot, { type PendingOperation } from "./bucket_snapshot";
import { getConstructorForElementClass, uint8ToTypedBuffer } from "../helpers/typed_buffer";

export enum BucketStateEnum {
  UNREQUESTED = "UNREQUESTED",
  REQUESTED = "REQUESTED",
  MISSING = "MISSING", // Missing means that the bucket couldn't be found on the data store
  LOADED = "LOADED",
}
export type BucketStateEnumType = keyof typeof BucketStateEnum;

const WARNING_THROTTLE_THRESHOLD = 10000;

const warnMergeWithoutPendingOperations = _.throttle(() => {
  ErrorHandling.notify(
    new Error("Bucket.merge() was called with an empty list of pending operations."),
  );
}, WARNING_THROTTLE_THRESHOLD);

export function assertNonNullBucket(bucket: Bucket): asserts bucket is DataBucket {
  if (bucket.type === "null") {
    throw new Error("Unexpected null bucket.");
  }
}

export class NullBucket {
  readonly type = "null" as const;

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

export const NULL_BUCKET = new NullBucket();
export type Bucket = DataBucket | NullBucket;

// This set saves whether a bucket is already added to the current undo volume batch
// and gets cleared when a volume transaction is ended (marked by the action
// FINISH_ANNOTATION_STROKE).
export const bucketsAlreadyInUndoState: Set<Bucket> = new Set();
export function markVolumeTransactionEnd() {
  bucketsAlreadyInUndoState.clear();
}

export class DataBucket {
  readonly type = "data" as const;
  readonly elementClass: ElementClass;
  readonly zoomedAddress: BucketAddress;
  // todop: or should it be versionAtInstantiationTime ? remove again?
  versionAtRequestTime: number | null = null;
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
  pendingOperations: Array<PendingOperation> = [];
  state: BucketStateEnumType;
  accessed: boolean;
  data: BucketDataArray | null | undefined;
  temporalBucketManager: TemporalBucketManager;
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
    this._debuggerMaybe();
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

  mayBeGarbageCollected(): boolean {
    const collect =
      !this.accessed &&
      !this.dirty &&
      this.state !== BucketStateEnum.REQUESTED &&
      this.dirtyCount === 0;
    return collect;
  }

  destroy(): void {
    this._debuggerMaybe();
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

  async label_DEPRECATED(labelFunc: PendingOperation): Promise<void> {
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

    Store.dispatch(
      // Always use the current state of this.maybeUnmergedBucketLoadedPromise, since
      // this bucket could be added to multiple undo batches while it's fetched. All entries
      // need to have the corresponding promise for the undo to work correctly.
      addBucketToUndoAction(this.getSnapshot("MUTATION")),
    );
  }

  getSnapshot(purpose: "MUTATION" | "PREPARE_RESTORE_TO_SNAPSHOT"): BucketSnapshot {
    // getSnapshot is called in two use cases:
    // 1) The user mutates data.
    //    If this.data is null, it will be allocated and the bucket will be added
    //    to the pullQueue and temporalBucketManager.
    // 2) The user uses undo/redo which will restore the bucket to another snapshot.
    //    Before this restoration is done, the current version is snapshotted.
    //    In that case, data must not be null, as it's important that we don't
    //    initiate a new request from the back-end. If we did this, we would depend
    //    on the correct version being fetched. Correct would be the most recent
    //    version, but older snapshots might depend on another version.

    if (purpose === "PREPARE_RESTORE_TO_SNAPSHOT" && this.data == null) {
      throw new Error("Unexpected getSnapshot call.");
      // this scenario can happen when
      // - the user hits undo and an older version of this bucket should be restored.
      // - however, this bucket was gc'ed and has no local changes
      // in this scenario:
      // - there are no unsaved changes.
      // - when restoring the snapshot, the version of the bucket should be loaded
      //   that was stored at the backend at the current time.
      // This "if" avoids that getCopyOfData() is called.
      // The consequences of that would be (and were in older versions):
      // - getOrCreateData()
      // - this.temporalBucketManager.addBucket(this);
      // - pullBucket()
      // Thus, the newest version of this bucket would be requested.
      // When the user hits undo, getSnapshot("PREPARE_RESTORE_TO_SNAPSHOT") is called before restoreToSnapshot.
      // This means, that the newest bucket data would be fetched asynchronously
      // and then it would overwrite the mutation in restoreToSnapshot.

      // const volumeTracing = getVolumeTracingById(Store.getState().tracing, this.getTracingId());
      // const version = volumeTracing.version;

      // return new BucketSnapshot(
      //   this.zoomedAddress,
      //   null,
      //   null,
      //   null,
      //   this.getTracingId(),
      //   this.elementClass,
      //   this.versionAtRequestTime,
      // );
    }

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

    return new BucketSnapshot(
      this.zoomedAddress,
      dataClone,
      this.maybeUnmergedBucketLoadedPromise,
      this.pendingOperations.slice(),
      this.getTracingId(),
      this.elementClass,
      this.versionAtRequestTime,
    );
  }

  async restoreToSnapshot(snapshot: BucketSnapshot): Promise<void> {
    // This function is async, but can still finish offline, because
    // getDataForRestore only needs to wait for decompression in the webworker.
    const { newData, newPendingOperations } = await snapshot.getDataForRestore();
    // Set the new bucket data. This will add the bucket directly to the pushqueue, too.
    this.setData(newData, newPendingOperations);

    // needsMergeWithBackendData should be irrelevant. if the snapshot is complete,
    // the bucket should also be loaded.
    // if it's not complete, the bucket should already be requested.

    if (this.state === BucketStateEnum.UNREQUESTED) {
      this._logMaybe(
        "setData was called but state is still unrequested. will probably be overwritten?",
      );
    } else {
      this._logMaybe("setData was called. state==", this.state);
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

  setData(newData: BucketDataArray, newPendingOperations: Array<PendingOperation>) {
    this.data = newData;
    this.invalidateValueSet();
    this.pendingOperations = newPendingOperations;
    this.dirty = true;
    this.endDataMutation();
    this.cube.triggerBucketDataChanged();
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
    this.throttledTriggerLabeled();
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

  markAsPulled(versionAtRequestTime: number | null): void {
    // todop (only renaming): rename to markAsRequested
    switch (this.state) {
      case BucketStateEnum.UNREQUESTED: {
        this.versionAtRequestTime = versionAtRequestTime;
        this._debuggerMaybe();
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
    if (this.data != null) {
      this._logMaybe("bucket.receiveData was called, but this.data already exists.");
    }
    const data = uint8ToTypedBuffer(arrayBuffer, this.elementClass);
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
        // Clone the data for the unmergedBucketDataLoaded event,
        // as the following merge operation is done in-place.
        const dataClone = new TypedArrayClass(data);
        this.trigger("unmergedBucketDataLoaded", dataClone);

        if (this.dirty) {
          this.merge(data);
        } else {
          this.data = data;
        }
        this.invalidateValueSet();
        this._debuggerMaybe();

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
    const addressStr = this.zoomedAddress.slice(0, 4).join(",");
    // console.log(addressStr, ...args);
    if (addressStr === [19, 30, 16, 0].join(",")) {
      console.log(addressStr, ...args);
    }
  };

  // debug position:
  // 619, 989, 533
  //
  //

  _debuggerMaybe = () => {
    const addressStr = this.zoomedAddress.slice(0, 4).join(",");
    if (addressStr === [19, 30, 16, 0].join(",")) {
      // biome-ignore lint/suspicious/noDebugger: meant for debugging
      debugger;
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
      console.warn("Awaited missing bucket.");
    }
  }
}
