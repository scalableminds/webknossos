import app from "app";
import type { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";
import type UpdatableTexture from "libs/UpdatableTexture";
import { waitForCondition } from "libs/utils";
import window from "libs/window";
import noop from "lodash-es/noop";
import range from "lodash-es/range";
import uniqBy from "lodash-es/uniqBy";
import type { DataTexture } from "three";
import type { AdditionalCoordinate, ElementClass } from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { BucketAddress } from "viewer/constants";
import constants, { type TypedArray } from "viewer/constants";
import { getRenderer } from "viewer/controller/renderer";
import { createUpdatableTexture } from "viewer/geometries/materials/plane_material_factory_helpers";
import type { DataBucket } from "viewer/model/bucket_data_handling/bucket";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import {
  getBucketCapacity,
  getBucketHeightInTexture,
  getDtypeConfigForElementClass,
} from "viewer/model/bucket_data_handling/data_rendering_logic";
import { PullQueueConstants } from "viewer/model/bucket_data_handling/pullqueue";

// A TextureBucketManager instance is responsible for making buckets available
// to the GPU.
// setActiveBuckets can be called with an array of buckets, which will be
// written into the dataTexture and lookUpTexture of this class instance
// (note that the lookUpTexture is shared across all layers).
// Buckets which are already in this texture won't be written again.
// Buckets which are not needed anymore will be replaced by other buckets.
// A bucket is considered "active" if it is supposed to be in the data texture.
// A bucket is considered "committed" if it is indeed in the data texture.
// Active buckets will be pushed into a writerQueue which is processed by
// writing buckets to the data texture (i.e., "committing the buckets").
//
// Within the lookUpTexture, we store one unsigned integer i per bucket.
// If i == 2**21 - 1, the bucket is not yet committed.
// Otherwise, i denotes the index in the data texture where the bucket is stored.

// See the explanations in the module that defines CuckooTableVec5 to read about
// the theoretical limitations of the look up approach.

const NOT_YET_COMMITTED_VALUE = 2 ** 21 - 1;

function getSomeValue<T>(set: Set<T>): T {
  const { value } = set.values().next();

  if (value == null) {
    throw new Error("Cannot get value of set because it's empty.");
  }

  return value;
}

// Sized for the largest possible (non-shrunk) bucket; layers with a smaller
// effective bucket footprint simply use a prefix of this scratch buffer.
const tmpPaddingBuffer = new Uint8Array(4 * constants.BUCKET_SIZE);
function maybePadRgbData(src: TypedArray, elementClass: ElementClass, bucketVoxelCount: number) {
  if (elementClass !== "uint24") {
    return src;
  }

  // Copy the RGB data to an RGBA buffer, since ThreeJS does not support RGB textures
  // since r137.
  let idx = 0;
  let srcIdx = 0;
  while (srcIdx < 3 * bucketVoxelCount) {
    // @ts-expect-error BigInt is not a problem as this code here only handles uint24 data
    tmpPaddingBuffer[idx++] = src[srcIdx++];
    // @ts-expect-error BigInt is not a problem as this code here only handles uint24 data
    tmpPaddingBuffer[idx++] = src[srcIdx++];
    // @ts-expect-error BigInt is not a problem as this code here only handles uint24 data
    tmpPaddingBuffer[idx++] = src[srcIdx++];
    tmpPaddingBuffer[idx++] = 255;
  }

  return tmpPaddingBuffer.subarray(0, idx);
}

// A bucket's packed data may be smaller than one texture row (see
// getBucketHeightInTexture), in which case it still occupies a full row in the
// atlas, with the remainder left unused. gl.texSubImage2D requires the source
// buffer to cover the full row/height being uploaded, so the real data is copied
// into a zero-filled scratch buffer of the right size for that (rare) case.
let tmpRowPaddingBuffer: TypedArray | null = null;
function padToFullRow(src: TypedArray, requiredElementCount: number): TypedArray {
  if (src.length >= requiredElementCount) {
    return src;
  }

  if (
    tmpRowPaddingBuffer == null ||
    tmpRowPaddingBuffer.constructor !== src.constructor ||
    tmpRowPaddingBuffer.length < requiredElementCount
  ) {
    // @ts-expect-error TypedArray constructors all accept a length argument.
    tmpRowPaddingBuffer = new src.constructor(requiredElementCount);
  }

  const buffer = tmpRowPaddingBuffer as TypedArray;
  const target = buffer.subarray(0, requiredElementCount);
  // @ts-expect-error BigInt is not a problem in practice; only used for byte-level GPU upload buffers.
  target.fill(0);
  // @ts-expect-error src and target always share the same underlying element type.
  target.set(src);
  return target;
}

export default class TextureBucketManager {
  dataTextures: Array<UpdatableTexture>;
  layerIndex: number = -1;
  lookUpCuckooTable!: CuckooTableVec5;
  // Holds the index for each active bucket, to which it should (or already
  // has been was) written in the data texture. Used for all layers EXCEPT
  // t-recycling-enabled ones, which use activeGroups instead (since several
  // sibling buckets there share one atlas index).
  activeBucketToIndexMap: Map<DataBucket, number> = new Map();
  // t-recycling only: one shared atlas index per (x,y,mag,t-batch) group. The whole batch
  // (all 32 t-slices) is fetched and uploaded to the GPU together (see pullqueue.ts and
  // DataBucket.rawBucketData), so a group only ever needs a single representative bucket
  // reference (whichever t is currently the "primary" one) rather than per-slot tracking.
  // See setActiveBucketsTRecycling.
  private activeGroups: Map<string, { index: number; bucket: DataBucket }> = new Map();
  // t-recycling only: the primary buckets passed into the last setActiveBuckets
  // call, kept so retargetToNewT can re-derive the desired bucket set for a new t
  // without needing a fresh spatial pick.
  private lastPrimaryBuckets: Array<DataBucket> = [];
  // Maintains the set of committed buckets
  committedBucketSet: WeakSet<DataBucket> = new WeakSet();
  // Maintains a set of free indices within the data texture.
  freeIndexSet: Set<number>;
  isRefreshBufferOutOfDate: boolean = false;
  writerQueue: Array<{
    bucket: DataBucket;
    _index: number;
  }> = [];

  textureWidth: number;
  dataTextureCount: number;
  maximumCapacity: number;
  packingDegree: number;
  elementClass: ElementClass;
  // The number of voxels a single bucket occupies in this layer's atlas. Equal to
  // constants.BUCKET_SIZE, unless the layer has a degenerate (e.g., z-extent-1) axis.
  // See DataCube.effectiveBucketDepth / getEffectiveBucketDepth. For a t-recycling
  // layer, this is the full BUCKET_SIZE (see isTRecyclingEnabled below).
  bucketVoxelCount: number;
  // When true, this layer's (always-0) z-addressing slot is repurposed to cache
  // several t (time) slices of a z-degenerate layer simultaneously on the GPU,
  // instead of shrinking the bucket footprint to depth 1. See DataBucket.getT()
  // and the "t-recycling" design notes above setActiveBucketsTRecycling.
  isTRecyclingEnabled: boolean;
  private cube: DataCube;
  isDestroyed: boolean = false;
  private areTexturesReady: boolean = false;
  private isWriterQueueProcessingScheduled: boolean = false;

  constructor(
    textureWidth: number,
    dataTextureCount: number,
    elementClass: ElementClass,
    cube: DataCube,
  ) {
    // If there is one byte per voxel, we pack 4 bytes into one texel (packingDegree = 4)
    // Otherwise, we don't pack bytes together (packingDegree = 1)
    this.packingDegree = getDtypeConfigForElementClass(elementClass).packingDegree;
    this.elementClass = elementClass;
    this.cube = cube;

    this.isTRecyclingEnabled = cube.isTRecyclingEligible;

    this.bucketVoxelCount = this.isTRecyclingEnabled
      ? constants.BUCKET_SIZE
      : cube.getEffectiveBucketVoxelCount();
    this.maximumCapacity = getBucketCapacity(
      dataTextureCount,
      textureWidth,
      this.packingDegree,
      this.bucketVoxelCount,
    );
    this.textureWidth = textureWidth;
    this.dataTextureCount = dataTextureCount;
    this.freeIndexSet = new Set(range(this.maximumCapacity));
    this.dataTextures = [];
  }

  async startRAFLoop() {
    await waitForCondition(
      () =>
        this.lookUpCuckooTable?._texture.isInitialized() && this.dataTextures[0].isInitialized(),
    );
    this.areTexturesReady = true;
    this.processWriterQueue();
  }

  // Schedules a processWriterQueue call for the next animation frame (if
  // none is scheduled yet). The queue processing is event-driven (triggered
  // by new writerQueue entries) instead of an unconditional rAF loop so that
  // the tab can idle when there is nothing to write.
  private scheduleWriterQueueProcessing() {
    if (this.isWriterQueueProcessingScheduled || !this.areTexturesReady || this.isDestroyed) {
      return;
    }
    this.isWriterQueueProcessingScheduled = true;
    window.requestAnimationFrame(() => {
      this.isWriterQueueProcessingScheduled = false;
      this.processWriterQueue();
    });
  }

  clear() {
    this.setActiveBuckets([]);
  }

  // For t-recycling-enabled layers, the (always-0) real z-addressing slot is
  // repurposed to encode a "t-batch index" (floor(t/32)) instead, since up to 32
  // t-slices of a z-degenerate layer share one atlas region/upload (see
  // processWriterQueue and DataBucket.rawBucketData). This keeps the cuckoo table's
  // key format/structure completely unchanged; the GLSL shader looks up by the same
  // floor(t/32) to find the batch, then t%32 within it (see texture_access.glsl.ts).
  private getCuckooKey(bucket: DataBucket): [number, number, number, number, number] {
    const z = this.isTRecyclingEnabled
      ? Math.floor(bucket.getT() / constants.BUCKET_WIDTH)
      : bucket.zoomedAddress[2];
    return [
      bucket.zoomedAddress[0],
      bucket.zoomedAddress[1],
      z,
      bucket.zoomedAddress[3],
      this.layerIndex,
    ];
  }

  freeBucket(bucket: DataBucket): void {
    const unusedIndex = this.activeBucketToIndexMap.get(bucket);

    if (unusedIndex == null) {
      return;
    }

    if (WkDevFlags.bucketDebugging.visualizeBucketsOnGPU) {
      bucket.unvisualize();
    }

    this.activeBucketToIndexMap.delete(bucket);
    this.committedBucketSet.delete(bucket);
    this.freeIndexSet.add(unusedIndex);
    this.lookUpCuckooTable.unset(this.getCuckooKey(bucket));

    // If a bucket is evicted from the GPU, it should not be rendered, anymore.
    // This is especially important when new buckets take a while to load. In that
    // time window, old data should not be rendered.
    app.vent.emit("rerender");
  }

  // Takes an array of buckets and ensures that these
  // are written to the dataTexture. The lookUpTexture will be updated to reflect the
  // new buckets.
  setActiveBuckets(buckets: Array<DataBucket>): void {
    if (this.isTRecyclingEnabled) {
      this.setActiveBucketsTRecycling(buckets);
      return;
    }

    // Find out which buckets are not needed anymore
    const freeBucketSet = new Set(this.activeBucketToIndexMap.keys());

    for (const bucket of buckets) {
      freeBucketSet.delete(bucket);
    }

    // Remove unused buckets
    for (const freeBucket of freeBucketSet.values()) {
      this.freeBucket(freeBucket);
    }

    for (const nextBucket of buckets) {
      if (!this.activeBucketToIndexMap.has(nextBucket)) {
        if (this.freeIndexSet.size === 0) {
          throw new Error("A new bucket should be stored but there is no space for it?");
        }

        const freeBucketIdx = getSomeValue(this.freeIndexSet);
        this.reserveIndexForBucket(nextBucket, freeBucketIdx);
      }
    }
  }

  private getGroupKey(bucket: DataBucket): string {
    const [x, y, , mag] = bucket.zoomedAddress;
    const batchIndex = Math.floor(bucket.getT() / constants.BUCKET_WIDTH);
    return `${x}_${y}_${mag}_${batchIndex}`;
  }

  // Every DataBucket ever created stays in DataCube's GC pool forever (see
  // DataCube.addBucketToGarbageCollection) until explicitly marked needed/unneeded; a
  // bucket that's never marked needed is an immediate, permanent GC target. Since only
  // the primary bucket passed to setActiveBucketsTRecycling goes through the normal
  // pick -> markAsNeeded cycle, its up-to-31 batch siblings (created as a side effect of
  // PullQueue's t-batched fetch, see pullqueue.ts) would otherwise be collected shortly
  // after being fetched — defeating the point of keeping a whole batch resident for fast
  // scrubbing, and, worse, inflating bucket churn enough to make the GC scan (which runs
  // on every single new-bucket creation once the pool exceeds BUCKET_COUNT_SOFT_LIMIT)
  // run far more often, making it far more likely to catch some *other*, still-needed
  // bucket in the brief markBucketsAsUnneeded->markAsNeeded window every re-pick has.
  // Calling this every re-pick (mirroring how a primary bucket gets re-marked every
  // cycle) keeps the whole batch protected for as long as any t within it is desired.
  private markBatchSiblingsAsNeeded(bucket: DataBucket): void {
    const t = bucket.getT();
    const batchStart = Math.floor(t / constants.BUCKET_WIDTH) * constants.BUCKET_WIDTH;
    const bounds = this.cube.additionalAxes.t?.bounds;
    const additionalCoordinates = bucket.getAdditionalCoordinates() ?? [];

    for (let dt = 0; dt < constants.BUCKET_WIDTH; dt++) {
      const nt = batchStart + dt;
      if (nt === t) {
        continue;
      }
      if (bounds != null && (nt < bounds[0] || nt >= bounds[1])) {
        continue;
      }

      const siblingCoordinates = additionalCoordinates.map((coord) =>
        coord.name === "t" ? { ...coord, value: nt } : coord,
      );
      const siblingAddress: BucketAddress = [
        bucket.zoomedAddress[0],
        bucket.zoomedAddress[1],
        bucket.zoomedAddress[2],
        bucket.zoomedAddress[3],
        siblingCoordinates,
      ];
      const sibling = this.cube.getOrCreateBucket(siblingAddress);
      if (sibling.type === "null") {
        continue;
      }
      sibling.markAsNeeded();
    }
  }

  // t-recycling-enabled layers always fetch a bucket's whole t-batch in one request
  // (see pullqueue.ts's use of DataCube.isTRecyclingEligible), and every bucket in that
  // batch ends up with its `.data` backed by one shared buffer (see
  // DataBucket.rawBucketData). So a group only needs to track whichever single t is
  // currently "primary" (the one actually requested for rendering) — its rawBucketData
  // already holds the full batch, ready to upload in one go (see processWriterQueue).
  private setActiveBucketsTRecycling(primaryBuckets: Array<DataBucket>): void {
    this.lastPrimaryBuckets = primaryBuckets;
    const desiredGroups = new Map<string, DataBucket>();

    for (const bucket of primaryBuckets) {
      desiredGroups.set(this.getGroupKey(bucket), bucket);
      this.markBatchSiblingsAsNeeded(bucket);
    }

    // Remove unused groups
    for (const [groupKey, group] of this.activeGroups) {
      if (!desiredGroups.has(groupKey)) {
        this.freeGroup(groupKey, group);
      }
    }

    for (const [groupKey, bucket] of desiredGroups) {
      this.reserveOrUpdateGroup(groupKey, bucket);
    }
  }

  // For a pure t change (no camera/zoom/viewport change), re-derives the desired
  // bucket set from the last primary buckets with the new t swapped in, instead of
  // requiring a fresh spatial pick. If the new t is in the same batch as before,
  // setActiveBucketsTRecycling's group diffing naturally finds the group already
  // resident (no new GPU upload); if it's a different batch, the same diffing
  // correctly frees the old batch's group(s) and reserves/uploads the new one(s).
  // Only meaningful when isTRecyclingEnabled; callers should check that themselves.
  retargetToNewT(additionalCoordinates: AdditionalCoordinate[] | null): void {
    const newPrimaryBuckets = this.lastPrimaryBuckets
      .map((oldBucket) => {
        const newAddress: BucketAddress = [
          oldBucket.zoomedAddress[0],
          oldBucket.zoomedAddress[1],
          oldBucket.zoomedAddress[2],
          oldBucket.zoomedAddress[3],
          additionalCoordinates ?? [],
        ];
        return this.cube.getOrCreateBucket(newAddress);
      })
      .filter((bucket): bucket is DataBucket => bucket.type !== "null");

    this.setActiveBucketsTRecycling(newPrimaryBuckets);
  }

  // t-recycling counterpart to freeBucket: frees the group's shared atlas index and
  // unsets its cuckoo entry. Only called once a group has no primary bucket left that
  // needs it (see setActiveBucketsTRecycling), or when its representative bucket is
  // collected (see attachGroupLifecycleListeners).
  private freeGroup(groupKey: string, group: { index: number; bucket: DataBucket }): void {
    if (WkDevFlags.bucketDebugging.visualizeBucketsOnGPU) {
      group.bucket.unvisualize();
    }

    this.activeGroups.delete(groupKey);
    this.committedBucketSet.delete(group.bucket);
    this.freeIndexSet.add(group.index);
    this.lookUpCuckooTable.unset(this.getCuckooKey(group.bucket));

    app.vent.emit("rerender");
  }

  // t-recycling counterpart to reserveIndexForBucket. A group's whole t-batch is always
  // fetched and uploaded to the GPU together (see pullqueue.ts, DataBucket.rawBucketData,
  // and processWriterQueue), so scrubbing to a different t within an already-resident
  // batch only needs to swap which bucket represents the group (for future lifecycle
  // listeners) — no new GPU upload. Only a genuinely new group needs an index reserved
  // and its first upload enqueued.
  private reserveOrUpdateGroup(groupKey: string, bucket: DataBucket): void {
    const existingGroup = this.activeGroups.get(groupKey);

    if (existingGroup != null) {
      if (existingGroup.bucket !== bucket) {
        existingGroup.bucket = bucket;
        this.attachGroupLifecycleListeners(groupKey, bucket);
      }
      return;
    }

    if (this.freeIndexSet.size === 0) {
      throw new Error("A new bucket should be stored but there is no space for it?");
    }

    const index = getSomeValue(this.freeIndexSet);
    this.freeIndexSet.delete(index);
    this.activeGroups.set(groupKey, { index, bucket });
    this.lookUpCuckooTable.set(this.getCuckooKey(bucket), NOT_YET_COMMITTED_VALUE);

    if (bucket.hasData()) {
      this.writerQueue.unshift({ bucket, _index: index });
      this.scheduleWriterQueueProcessing();
    } else if (bucket.needsRequest()) {
      // A genuinely new group (a fresh t-batch) needs its data actively requested. Unlike
      // a full viewport re-pick (see LayerRenderingManager.updateDataTextures), which
      // enqueues every missing bucket itself, retargetToNewT's pure-t-scrub fast path only
      // looks up/creates this bucket — nothing else is guaranteed to ever request it, so
      // without this call this group would sit at NOT_YET_COMMITTED_VALUE forever. Pull
      // queue's own t-batching (see pullqueue.ts) takes care of fetching this bucket's
      // whole sibling batch from just this one request.
      this.cube.pullQueue.add({
        bucket: bucket.zoomedAddress,
        priority: PullQueueConstants.PRIORITY_HIGHEST,
      });
      this.cube.pullQueue.pull();
    }

    this.attachGroupLifecycleListeners(groupKey, bucket);
  }

  // Enqueues a (re-)upload of `bucket`'s group once its data arrives, and frees the
  // group once `bucket` is collected — but only as long as `bucket` is still the
  // group's current representative (it may have been swapped out by a later call to
  // reserveOrUpdateGroup for a different t in the same batch in the meantime).
  private attachGroupLifecycleListeners(groupKey: string, bucket: DataBucket): void {
    let unlistenToLoadedFn = noop;

    if (!bucket.hasData()) {
      unlistenToLoadedFn = bucket.on("bucketLoaded", () => {
        const group = this.activeGroups.get(groupKey);
        if (group?.bucket !== bucket) {
          return;
        }
        this.writerQueue.unshift({ bucket, _index: group.index });
        this.scheduleWriterQueueProcessing();
      });
    }

    bucket.once("bucketCollected", () => {
      unlistenToLoadedFn();
      const group = this.activeGroups.get(groupKey);
      if (group?.bucket === bucket) {
        this.freeGroup(groupKey, group);
      }
    });
  }

  getPackedBucketSize() {
    return this.bucketVoxelCount / this.packingDegree;
  }

  // Commit "active" buckets by writing these to the dataTexture.
  processWriterQueue() {
    if (this.isDestroyed) {
      // Avoid new requestAnimationFrame
      return;
    }
    if (this.writerQueue.length === 0) {
      // Nothing to do. The loop will be restarted when new entries are
      // enqueued (see scheduleWriterQueueProcessing).
      return;
    }
    // uniqBy removes multiple write-bucket-requests for the same atlas index. It
    // preserves the first occurrence of each duplicate, which is why this queue has to
    // be filled from the front (via unshift) und read from the back (via pop). This
    // ensures that the newest bucket "wins" if there are multiple requests for the same
    // index — including for a t-recycling group, where each request uploads that
    // bucket's whole (shared) batch buffer in one go, so only the latest one needs to
    // land.
    this.writerQueue = uniqBy(this.writerQueue, (el) => el._index);
    const maxTimePerFrame = 16;
    const startingTime = performance.now();
    const bucketHeightInTexture = getBucketHeightInTexture(
      this.textureWidth,
      this.packingDegree,
      this.bucketVoxelCount,
    );
    const bucketsPerTexture = this.textureWidth / bucketHeightInTexture;

    while (this.writerQueue.length > 0 && performance.now() - startingTime < maxTimePerFrame) {
      // @ts-expect-error pop cannot return null due to the while condition
      const { bucket, _index } = this.writerQueue.pop();

      if (this.isTRecyclingEnabled) {
        if (this.activeGroups.get(this.getGroupKey(bucket))?.bucket !== bucket) {
          // This bucket is no longer its group's representative (a different t within
          // the same batch took over, or the group was freed entirely) — nothing to do.
          continue;
        }
      } else if (!this.activeBucketToIndexMap.has(bucket)) {
        // This bucket is not needed anymore
        continue;
      }

      if (bucket.data == null) {
        // The bucket is not available anymore (was collected
        // and not yet removed from the queue). Ignore it.
        console.warn("Skipping unavailable bucket in TextureBucketManager.");
        continue;
      }

      if (WkDevFlags.bucketDebugging.visualizeBucketsOnGPU) {
        bucket.visualize();
      }

      const dataTextureIndex = Math.floor(_index / bucketsPerTexture);
      const indexInDataTexture = _index % bucketsPerTexture;
      const data = bucket.getData();
      const { TypedArrayClass } = getDtypeConfigForElementClass(this.elementClass);
      // For a t-recycling bucket, rawBucketData is the whole shared 32-slice batch
      // buffer (of which `data` is only this bucket's own single-slice window, per the
      // CPU-side shrink) — uploading it in full writes every t-slice in the batch to its
      // correct z-sub-slot in one call, since the batch buffer's byte layout already
      // matches the atlas's z-major layout (see DataBucket.rawBucketData/receiveData).
      // This is why bucketVoxelCount is the full BUCKET_SIZE for t-recycling layers: the
      // upload below is otherwise identical to the plain, non-recycling case.
      const uploadSource =
        this.isTRecyclingEnabled && bucket.rawBucketData != null ? bucket.rawBucketData : data;

      const rawSrc = new TypedArrayClass(
        uploadSource.buffer,
        uploadSource.byteOffset,
        uploadSource.byteLength / TypedArrayClass.BYTES_PER_ELEMENT,
      );

      const packedBucketSize = this.getPackedBucketSize();
      // Ratio between the raw elements needed to fill a whole texture row and the
      // raw elements a single bucket naturally produces. Equal to 1 unless
      // bucketHeightInTexture was clamped to one full row (see
      // getBucketHeightInTexture), in which case a bucket's data needs to be
      // padded to fill out that row for texSubImage2D (which requires the source
      // buffer to cover the full upload area).
      const rowPaddingRatio = (this.textureWidth * bucketHeightInTexture) / packedBucketSize;
      const rgbPaddedSrc = maybePadRgbData(rawSrc, this.elementClass, this.bucketVoxelCount);

      const x = 0;
      const y = bucketHeightInTexture * indexInDataTexture;
      const width = this.textureWidth;
      const height = bucketHeightInTexture;
      const src =
        rowPaddingRatio > 1
          ? padToFullRow(rgbPaddedSrc, Math.round(rgbPaddedSrc.length * rowPaddingRatio))
          : rgbPaddedSrc;

      this.dataTextures[dataTextureIndex].update(src, x, y, width, height);
      this.committedBucketSet.add(bucket);

      this.lookUpCuckooTable.set(this.getCuckooKey(bucket), _index);

      // bucket.setVisualizationColor("#00ff00");
      // bucket.visualize();
      app.vent.emit("rerender");
    }

    if (this.writerQueue.length > 0) {
      // The time budget was exhausted. Continue in the next frame.
      this.scheduleWriterQueueProcessing();
    }
  }

  getTextures(): Array<DataTexture | UpdatableTexture> {
    return [this.lookUpCuckooTable._texture].concat(this.dataTextures);
  }

  setupDataTextures(lookUpCuckooTable: CuckooTableVec5, layerIndex: number): void {
    for (let i = 0; i < this.dataTextureCount; i++) {
      const { textureType, pixelFormat, internalFormat } = getDtypeConfigForElementClass(
        this.elementClass,
      );

      const dataTexture = createUpdatableTexture(
        this.textureWidth,
        this.textureWidth,
        textureType,
        getRenderer(),
        pixelFormat,
        internalFormat,
      );

      this.dataTextures.push(dataTexture);
    }

    this.lookUpCuckooTable = lookUpCuckooTable;
    this.layerIndex = layerIndex;
    this.startRAFLoop();
  }

  // Assign an index to an active bucket and enqueue the bucket-index-tuple
  // to the writerQueue. Also, make sure that the bucket data is updated if
  // it changes.
  reserveIndexForBucket(bucket: DataBucket, index: number): void {
    this.freeIndexSet.delete(index);
    this.activeBucketToIndexMap.set(bucket, index);

    this.lookUpCuckooTable.set(this.getCuckooKey(bucket), NOT_YET_COMMITTED_VALUE);

    const enqueueBucket = (_index: number) => {
      if (!bucket.hasData()) {
        return;
      }

      this.writerQueue.unshift({
        bucket,
        _index,
      });
      this.scheduleWriterQueueProcessing();
    };

    enqueueBucket(index);
    let unlistenToLoadedFn = noop;
    let unlistenToLabeledFn = noop;

    const updateBucketData = () => {
      // Check that the bucket is still in the data texture.
      // Also the index could have changed, so retrieve the index again.
      const bucketIndex = this.activeBucketToIndexMap.get(bucket);

      if (bucketIndex != null) {
        enqueueBucket(bucketIndex);
      } else {
        unlistenToLabeledFn();
      }
    };

    if (!bucket.hasData()) {
      unlistenToLoadedFn = bucket.on("bucketLoaded", updateBucketData);
    }

    unlistenToLabeledFn = bucket.on("bucketLabeled", updateBucketData);
    bucket.once("bucketCollected", () => {
      unlistenToLoadedFn();
      unlistenToLabeledFn();
      this.freeBucket(bucket);
    });
  }

  destroy() {
    for (const texture of this.getTextures()) {
      texture.dispose();
    }
    this.dataTextures = [];
    // @ts-expect-error
    this.lookUpCuckooTable = null;
    this.isDestroyed = true;
    this.activeBucketToIndexMap = new Map();
    this.activeGroups = new Map();
  }
}
