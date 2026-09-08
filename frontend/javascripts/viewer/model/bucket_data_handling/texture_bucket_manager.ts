import app from "app";
import type { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";
import type UpdatableTexture from "libs/UpdatableTexture";
import { waitForCondition } from "libs/utils";
import window from "libs/window";
import noop from "lodash-es/noop";
import range from "lodash-es/range";
import uniqBy from "lodash-es/uniqBy";
import type { DataTexture } from "three";
import type { BucketDataArray, ElementClass } from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
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

// A bucket's packed data may cover less than the atlas region it is uploaded into —
// either because it packs into less than one full texture row (see
// getBucketHeightInTexture), which it still occupies entirely with the remainder unused,
// or because it is a single t-slice going into a full-depth t-recycling region. Since
// gl.texSubImage2D requires the source buffer to cover the whole region being uploaded,
// the real data is copied into a zero-filled scratch buffer of the right size, at
// destElementOffset (nonzero only for the t-recycling case, where the slice belongs in
// its own t-slot rather than at the start).
let tmpRowPaddingBuffer: TypedArray | null = null;
function padToUploadRegion(
  src: TypedArray,
  requiredElementCount: number,
  destElementOffset: number = 0,
): TypedArray {
  if (destElementOffset === 0 && src.length >= requiredElementCount) {
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
  target.set(src, destElementOffset);
  return target;
}

export default class TextureBucketManager {
  dataTextures: Array<UpdatableTexture>;
  layerIndex: number = -1;
  lookUpCuckooTable!: CuckooTableVec5;
  // Holds the index for each active bucket, to which it should (or already
  // has been was) written in the data texture.
  activeBucketToIndexMap: Map<DataBucket, number> = new Map();
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
  // instead of shrinking the bucket footprint to depth 1. See getCuckooKey and
  // DataBucket.getT().
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
  //
  // For a t-recycling layer, the passed buckets all share the flycam's current t (they
  // come from one bucket pick), and therefore all belong to the same t-batch. Since the
  // cuckoo key only encodes the *batch* (see getCuckooKey) and one upload covers the whole
  // batch (see processWriterQueue), no extra bookkeeping is needed here: one active bucket
  // per (x, y, mag) maps to one atlas slot, exactly like for any other layer. Note that
  // two active buckets of a t-recycling layer can never collide on the same cuckoo key,
  // because such a layer is z-degenerate, so DataCube's containment check only ever hands
  // out z == 0 buckets.
  setActiveBuckets(buckets: Array<DataBucket>): void {
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
    // index — including on a t-recycling layer, where each request uploads that bucket's
    // whole (shared) batch buffer in one go, so only the latest one needs to land.
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

      if (!this.activeBucketToIndexMap.has(bucket)) {
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
      // This is why bucketVoxelCount is the full BUCKET_SIZE for t-recycling layers.
      const useRawBatchData = this.isTRecyclingEnabled && bucket.rawBucketData != null;
      const uploadSource = useRawBatchData ? (bucket.rawBucketData as BucketDataArray) : data;
      // How many voxels the source covers: the full atlas footprint for a batch buffer,
      // and the layer's (possibly shrunk) per-bucket footprint otherwise.
      const uploadVoxelCount = useRawBatchData
        ? this.bucketVoxelCount
        : this.cube.getEffectiveBucketVoxelCount();

      const rawSrc = new TypedArrayClass(
        uploadSource.buffer,
        uploadSource.byteOffset,
        uploadSource.byteLength / TypedArrayClass.BYTES_PER_ELEMENT,
      );

      const rgbPaddedSrc = maybePadRgbData(rawSrc, this.elementClass, uploadVoxelCount);

      const x = 0;
      const y = bucketHeightInTexture * indexInDataTexture;
      const width = this.textureWidth;
      const height = bucketHeightInTexture;
      // texSubImage2D requires the source buffer to cover the whole (x, y, width, height)
      // region. The source may fall short of it, either because a bucket packs into less
      // than one full texture row (see getBucketHeightInTexture) or because it covers less
      // than the atlas footprint (see uploadVoxelCount). Both are fixed by zero-padding.
      const requiredElementCount = Math.round(
        (rgbPaddedSrc.length * width * height) / (uploadVoxelCount / this.packingDegree),
      );
      // A lone t-slice must land in the t-slot the shader will read it from (t % 32, see
      // texture_access.glsl.ts's maybeOverrideOffsetInBucketZ), not at the start of the
      // region. Slices are equally sized, so the slot's offset is just zSlot source-lengths
      // in. This should not be reachable now that editable layers are excluded from
      // t-recycling (see wantsTRecycling) — the eligible ones always upload a whole shared
      // batch buffer — but placing the slice correctly beats silently rendering it at t=0.
      const destElementOffset =
        this.isTRecyclingEnabled && !useRawBatchData
          ? (bucket.getT() % constants.BUCKET_WIDTH) * rgbPaddedSrc.length
          : 0;
      const src = padToUploadRegion(rgbPaddedSrc, requiredElementCount, destElementOffset);

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
  }
}
