import app from "app";
import type { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";
import type UpdatableTexture from "libs/UpdatableTexture";
import { waitForCondition } from "libs/utils";
import window from "libs/window";
import noop from "lodash-es/noop";
import range from "lodash-es/range";
import uniqBy from "lodash-es/uniqBy";
import type { DataTexture } from "three";
import type { ElementClass } from "types/api_types";
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
  // t-recycling-enabled ones, which use activeGroups/bucketToGroupKey instead
  // (since several sibling buckets there share one atlas index).
  activeBucketToIndexMap: Map<DataBucket, number> = new Map();
  // t-recycling only: groups up to 32 sibling buckets (same x/y/mag, different t,
  // same t-batch) sharing one atlas index, one z-sub-slot (t % 32) each. See
  // setActiveBucketsTRecycling.
  private activeGroups: Map<string, { index: number; slots: Map<number, DataBucket> }> = new Map();
  private bucketToGroupKey: Map<DataBucket, string> = new Map();
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

    const hasTAxis = cube.additionalAxes.t != null;
    // No row-alignment guard needed: packedSliceSize (32^2/packingDegree) and
    // textureWidth are both always powers of 2, so a slice's texels either span an
    // exact whole number of full rows, or several slices fit exactly side by side
    // within one row — never a partial straddle. See processWriterQueue for the
    // general slice-placement formula that handles both cases.
    this.isTRecyclingEnabled = cube.effectiveBucketDepth === 1 && hasTAxis;

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
  // t-slices of a z-degenerate layer share one atlas region (see processWriterQueue's
  // zSlot computation for where t%32 is used instead). This keeps the cuckoo table's
  // key format/structure completely unchanged.
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

  // For a bucket belonging to a t-recycling-enabled layer, fetches/creates the
  // other (up to 31) buckets that share its t-batch (same x/y/mag, t values
  // floor(t/32)*32 .. +31, excluding the bucket's own t), so they can all be
  // written into the same shared atlas region. This eagerly requests the whole
  // batch rather than a bounded window around the current t: the backend may
  // eventually serve a full xyt bucket in one request, at which point "the whole
  // batch" is naturally just one fetch; until then this simulates that by
  // requesting all siblings individually via the existing pull queue. Buckets
  // that haven't arrived yet may render stale/incorrect data for their z-slot in
  // the meantime — accepted for now (see plan notes).
  private getBatchSiblings(bucket: DataBucket): Array<DataBucket> {
    return;
    const t = bucket.getT();
    const batchStart = Math.floor(t / constants.BUCKET_WIDTH) * constants.BUCKET_WIDTH;
    const bounds = this.cube.additionalAxes.t?.bounds;
    const additionalCoordinates = bucket.getAdditionalCoordinates() ?? [];
    const siblings: Array<DataBucket> = [];

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
      if (!sibling.hasData()) {
        // Lower priority than normal spatial prefetch/highest-priority requests
        // (smaller number = higher priority, see PullQueueConstants).
        this.cube.pullQueue.add({ bucket: sibling.zoomedAddress, priority: 100 });
      }
      siblings.push(sibling);
    }

    this.cube.pullQueue.pull();
    return siblings;
  }

  private setActiveBucketsTRecycling(primaryBuckets: Array<DataBucket>): void {
    const desired = new Set<DataBucket>();

    for (const bucket of primaryBuckets) {
      desired.add(bucket);
      for (const sibling of this.getBatchSiblings(bucket)) {
        desired.add(sibling);
      }
    }

    // Remove unused buckets
    for (const activeBucket of this.bucketToGroupKey.keys()) {
      if (!desired.has(activeBucket)) {
        this.freeBucketSlot(activeBucket);
      }
    }

    for (const nextBucket of desired) {
      if (!this.bucketToGroupKey.has(nextBucket)) {
        this.reserveSlotForBucket(nextBucket);
      }
    }
  }

  // t-recycling counterpart to freeBucket: frees a single sibling's slot within
  // its group, only returning the group's shared atlas index (and unsetting its
  // cuckoo entry) once every slot in the group has been freed.
  private freeBucketSlot(bucket: DataBucket): void {
    const groupKey = this.bucketToGroupKey.get(bucket);

    if (groupKey == null) {
      return;
    }

    const group = this.activeGroups.get(groupKey);

    if (group == null) {
      return;
    }

    if (WkDevFlags.bucketDebugging.visualizeBucketsOnGPU) {
      bucket.unvisualize();
    }

    group.slots.delete(bucket.getT() % constants.BUCKET_WIDTH);
    this.bucketToGroupKey.delete(bucket);
    this.committedBucketSet.delete(bucket);

    if (group.slots.size === 0) {
      this.activeGroups.delete(groupKey);
      this.freeIndexSet.add(group.index);
      this.lookUpCuckooTable.unset(this.getCuckooKey(bucket));
    }

    app.vent.emit("rerender");
  }

  // t-recycling counterpart to reserveIndexForBucket: assigns the bucket to its
  // group's z-sub-slot (t % 32), reserving a fresh shared atlas index for the
  // group the first time any of its siblings becomes active.
  private reserveSlotForBucket(bucket: DataBucket): void {
    const groupKey = this.getGroupKey(bucket);
    let group = this.activeGroups.get(groupKey);

    if (group == null) {
      if (this.freeIndexSet.size === 0) {
        throw new Error("A new bucket should be stored but there is no space for it?");
      }

      const index = getSomeValue(this.freeIndexSet);
      this.freeIndexSet.delete(index);
      group = { index, slots: new Map() };
      this.activeGroups.set(groupKey, group);
      this.lookUpCuckooTable.set(this.getCuckooKey(bucket), NOT_YET_COMMITTED_VALUE);
    }

    const groupForClosure = group;
    group.slots.set(bucket.getT() % constants.BUCKET_WIDTH, bucket);
    this.bucketToGroupKey.set(bucket, groupKey);

    const enqueueBucket = () => {
      if (!bucket.hasData()) {
        return;
      }

      this.writerQueue.unshift({
        bucket,
        _index: groupForClosure.index,
      });
      this.scheduleWriterQueueProcessing();
    };

    enqueueBucket();
    let unlistenToLoadedFn = noop;
    let unlistenToLabeledFn = noop;

    const updateBucketData = () => {
      // Check that the bucket is still assigned to a slot in this group.
      if (this.bucketToGroupKey.get(bucket) === groupKey) {
        enqueueBucket();
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
      this.freeBucketSlot(bucket);
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
    // uniqBy removes multiple write-buckets-requests for the same (index, zSlot).
    // It preserves the first occurrence of each duplicate, which is why
    // this queue has to be filled from the front (via unshift) und read from the
    // back (via pop). This ensures that the newest bucket "wins" if there are
    // multiple buckets for the same (index, zSlot). Note that zSlot is part of the
    // key so that sibling buckets sharing one t-recycling group's index (but
    // occupying different z-sub-slots) don't get deduped away from each other; for
    // non-t-recycling buckets, getT() is always 0, so this degenerates to a plain
    // per-index dedup (unchanged behavior).
    this.writerQueue = uniqBy(
      this.writerQueue,
      (el) => `${el._index}_${el.bucket.getT() % constants.BUCKET_WIDTH}`,
    );
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

      if (!this.activeBucketToIndexMap.has(bucket) && !this.bucketToGroupKey.has(bucket)) {
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

      const rawSrc = new TypedArrayClass(
        data.buffer,
        data.byteOffset,
        data.byteLength / TypedArrayClass.BYTES_PER_ELEMENT,
      );

      let x: number;
      let y: number;
      let width: number;
      let height: number;
      let src: TypedArray;

      if (this.isTRecyclingEnabled) {
        // This bucket's data is only one t-slice (32x32x1 voxels, per the CPU-side
        // shrink) that belongs at z-sub-slot t%32 within the otherwise-full-depth
        // (32768-voxel) atlas region for its (x,y,mag,t-batch) group. Since both
        // packedSliceSize and textureWidth are always powers of 2, a slice's
        // texels are always expressible as a single rectangle: either several
        // slices fit exactly side by side within one row, or one slice spans an
        // exact whole number of full rows — never a partial straddle.
        const zSlot = bucket.getT() % constants.BUCKET_WIDTH;
        const sliceVoxelCount = this.bucketVoxelCount / constants.BUCKET_WIDTH;
        const packedSliceSize = sliceVoxelCount / this.packingDegree;
        const sliceWidth = Math.min(packedSliceSize, this.textureWidth);
        const sliceHeight = Math.max(1, packedSliceSize / this.textureWidth);
        const slicesPerRow = this.textureWidth / sliceWidth;

        x = (zSlot % slicesPerRow) * sliceWidth;
        y =
          bucketHeightInTexture * indexInDataTexture +
          Math.floor(zSlot / slicesPerRow) * sliceHeight;
        width = sliceWidth;
        height = sliceHeight;
        // rgbPaddedSrc already has exactly sliceWidth*sliceHeight (== packedSliceSize)
        // texels' worth of data — no padding needed, unlike the non-recycling path below.
        src = maybePadRgbData(rawSrc, this.elementClass, sliceVoxelCount);
      } else {
        const packedBucketSize = this.getPackedBucketSize();
        // Ratio between the raw elements needed to fill a whole texture row and the
        // raw elements a single bucket naturally produces. Equal to 1 unless
        // bucketHeightInTexture was clamped to one full row (see
        // getBucketHeightInTexture), in which case a bucket's data needs to be
        // padded to fill out that row for texSubImage2D (which requires the source
        // buffer to cover the full upload area).
        const rowPaddingRatio = (this.textureWidth * bucketHeightInTexture) / packedBucketSize;
        const rgbPaddedSrc = maybePadRgbData(rawSrc, this.elementClass, this.bucketVoxelCount);

        x = 0;
        y = bucketHeightInTexture * indexInDataTexture;
        width = this.textureWidth;
        height = bucketHeightInTexture;
        src =
          rowPaddingRatio > 1
            ? padToFullRow(rgbPaddedSrc, Math.round(rgbPaddedSrc.length * rowPaddingRatio))
            : rgbPaddedSrc;
      }

      console.time("upload bucket to gpu");
      this.dataTextures[dataTextureIndex].update(src, x, y, width, height);
      this.committedBucketSet.add(bucket);
      console.timeEnd("upload bucket to gpu");

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
    this.bucketToGroupKey = new Map();
  }
}
