import app from "app";
import type UpdatableTexture from "libs/UpdatableTexture";
import LatestTaskExecutor, { SKIPPED_TASK_REASON } from "libs/async/latest_task_executor";
import { CuckooTableVec3 } from "libs/cuckoo/cuckoo_table_vec3";
import { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";
import DiffableMap from "libs/diffable_map";
import { M4x4, type Matrix4x4, V3 } from "libs/mjs";
import Toast from "libs/toast";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { DataTexture } from "three";
import type { AdditionalCoordinate } from "types/api_types";
import type { BucketAddress, Vector3, Vector4, ViewMode } from "viewer/constants";
import {
  getElementClass,
  getLayerByName,
  getMagInfo,
  isLayerVisible,
} from "viewer/model/accessors/dataset_accessor";
import type { DataBucket } from "viewer/model/bucket_data_handling/bucket";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import type PullQueue from "viewer/model/bucket_data_handling/pullqueue";
import TextureBucketManager from "viewer/model/bucket_data_handling/texture_bucket_manager";
import shaderEditor from "viewer/model/helpers/shader_editor";
import Store, { type PlaneRects, type SegmentMap } from "viewer/store";
import AsyncBucketPickerWorker from "viewer/workers/async_bucket_picker.worker";
import { createWorker } from "viewer/workers/comlink_wrapper";
import {
  getTransformsForLayer,
  invertAndTranspose,
} from "../accessors/dataset_layer_transformation_accessor";
import { getViewportRects } from "../accessors/view_mode_accessor";
import {
  getHideUnregisteredSegmentsForLayer,
  getSegmentsForLayer,
} from "../accessors/volumetracing_accessor";
import { listenToStoreProperty } from "../helpers/listener_helpers";
import { cachedDiffSegmentLists } from "../sagas/volumetracing_saga";

// 512**2 (entries) * 0.25 (load capacity) == 65_536 custom segment colors
const CUSTOM_COLORS_TEXTURE_WIDTH = 512;
// 256**2 (entries) * 0.25 (load capacity) / 8 (layers) == 2048 buckets/layer
const LOOKUP_CUCKOO_TEXTURE_WIDTH = 256;

const asyncBucketPickRaw = createWorker(AsyncBucketPickerWorker);
const asyncBucketPick = memoizeOne(asyncBucketPickRaw, (oldArgs, newArgs) =>
  _.isEqual(oldArgs, newArgs),
);
const dummyBuffer = new ArrayBuffer(0);
export type EnqueueFunction = (arg0: Vector4, arg1: number) => void;

// Lazily-initialized singleton.
const getSharedLookUpCuckooTable = memoizeOne(
  () => new CuckooTableVec5(LOOKUP_CUCKOO_TEXTURE_WIDTH),
);

function consumeBucketsFromArrayBuffer(
  buffer: ArrayBuffer,
  cube: DataCube,
  capacity: number,
  additionalCoordinates: AdditionalCoordinate[] | null,
): Array<{
  priority: number;
  bucket: DataBucket;
}> {
  const bucketsWithPriorities = [];
  const uint32Array = new Uint32Array(buffer);
  let currentElementIndex = 0;
  const intsPerItem = 5; // [x, y, z, zoomStep, priority]

  // Consume priority queue until we maxed out the capacity
  while (bucketsWithPriorities.length < capacity) {
    const currentBufferIndex = currentElementIndex * intsPerItem;

    if (currentBufferIndex >= uint32Array.length) {
      break;
    }

    const bucketAddress: BucketAddress = [
      uint32Array[currentBufferIndex],
      uint32Array[currentBufferIndex + 1],
      uint32Array[currentBufferIndex + 2],
      uint32Array[currentBufferIndex + 3],
      additionalCoordinates ?? [],
    ];
    const priority = uint32Array[currentBufferIndex + 4];
    const bucket = cube.getOrCreateBucket(bucketAddress);

    if (bucket.type !== "null") {
      // This tells the bucket collection, that the buckets are necessary for rendering
      bucket.markAsNeeded();
      bucketsWithPriorities.push({
        bucket,
        priority,
      });
    }

    currentElementIndex++;
  }

  return bucketsWithPriorities;
}

export function getGlobalLayerIndexForLayerName(
  layerName: string,
  optSanitizer?: (arg: string) => string,
): number {
  const sanitizer = optSanitizer || _.identity;
  const dataset = Store.getState().dataset;
  const layerIndex = dataset.dataSource.dataLayers.findIndex(
    (layer) => sanitizer(layer.name) === layerName,
  );

  return layerIndex;
}

export default class LayerRenderingManager {
  lastSphericalCapRadius: number | undefined;
  lastZoomedMatrix: Matrix4x4 | undefined;
  lastViewMode: ViewMode | undefined;
  lastIsVisible: boolean | undefined;
  lastRects: PlaneRects | undefined;
  textureBucketManager!: TextureBucketManager;
  textureWidth: number;
  cube: DataCube;
  pullQueue: PullQueue;
  dataTextureCount: number;
  name: string;
  needsRefresh: boolean = false;
  currentBucketPickerTick: number = 0;
  latestTaskExecutor: LatestTaskExecutor<ArrayBuffer> = new LatestTaskExecutor();
  additionalCoordinates: AdditionalCoordinate[] | null = null;
  maximumZoomForAllMags: number[] | null = null;

  private colorCuckooTable: CuckooTableVec3 | undefined;
  private storePropertyUnsubscribers: Array<() => void> = [];

  constructor(
    name: string,
    pullQueue: PullQueue,
    cube: DataCube,
    textureWidth: number,
    dataTextureCount: number,
  ) {
    this.name = name;
    this.pullQueue = pullQueue;
    this.cube = cube;
    this.textureWidth = textureWidth;
    this.dataTextureCount = dataTextureCount;
  }

  refresh() {
    this.needsRefresh = true;
    app.vent.emit("rerender");
  }

  setupDataTextures(): void {
    const { dataset } = Store.getState();
    const elementClass = getElementClass(dataset, this.name);
    this.textureBucketManager = new TextureBucketManager(
      this.textureWidth,
      this.dataTextureCount,
      elementClass,
    );

    const layerIndex = getGlobalLayerIndexForLayerName(this.name);

    this.textureBucketManager.setupDataTextures(getSharedLookUpCuckooTable(), layerIndex);
    shaderEditor.addBucketManagers(this.textureBucketManager);

    if (this.cube.isSegmentation) {
      this.listenToCustomSegmentColors();
    }
  }

  getDataTextures(): Array<DataTexture | UpdatableTexture> {
    if (!this.textureBucketManager) {
      // Initialize lazily since SceneController.renderer is not available earlier
      this.setupDataTextures();
    }

    return this.textureBucketManager.getTextures();
  }

  getSharedLookUpCuckooTable() {
    return getSharedLookUpCuckooTable();
  }

  updateDataTextures(position: Vector3, logZoomStep: number): void {
    const state = Store.getState();
    const { dataset, datasetConfiguration } = state;
    const layer = getLayerByName(dataset, this.name);
    const magInfo = getMagInfo(layer.resolutions);
    const maximumMagIndex = magInfo.getCoarsestMagIndex();

    if (logZoomStep > maximumMagIndex) {
      // Don't render anything if the zoomStep is too high
      this.textureBucketManager.setActiveBuckets([]);
      return;
    }

    const mags = getMagInfo(layer.resolutions).getDenseMags();
    const layerMatrix = invertAndTranspose(
      getTransformsForLayer(dataset, layer, datasetConfiguration.nativelyRenderedLayerName)
        .affineMatrix,
    );

    const matrix = M4x4.scale1(
      state.flycam.zoomStep,
      M4x4.mul(layerMatrix, state.flycam.currentMatrix),
    );

    const { viewMode } = state.temporaryConfiguration;
    const { sphericalCapRadius } = state.userConfiguration;
    const isVisible = isLayerVisible(dataset, this.name, datasetConfiguration, viewMode);
    const rects = getViewportRects(state);
    const additionalCoordinates = state.flycam.additionalCoordinates;
    const maximumZoomForAllMags = state.flycamInfoCache.maximumZoomForAllMags[this.name];

    if (
      !_.isEqual(this.lastZoomedMatrix, matrix) ||
      viewMode !== this.lastViewMode ||
      sphericalCapRadius !== this.lastSphericalCapRadius ||
      isVisible !== this.lastIsVisible ||
      rects !== this.lastRects ||
      !_.isEqual(additionalCoordinates, this.additionalCoordinates) ||
      !_.isEqual(maximumZoomForAllMags, this.maximumZoomForAllMags) ||
      this.needsRefresh
    ) {
      this.lastZoomedMatrix = matrix;
      this.lastViewMode = viewMode;
      this.lastSphericalCapRadius = sphericalCapRadius;
      this.lastIsVisible = isVisible;
      this.lastRects = rects;
      this.needsRefresh = false;
      this.currentBucketPickerTick++;
      this.additionalCoordinates = additionalCoordinates;
      this.maximumZoomForAllMags = maximumZoomForAllMags;
      this.pullQueue.clear();
      let pickingPromise: Promise<ArrayBuffer> = Promise.resolve(dummyBuffer);

      if (isVisible) {
        pickingPromise = this.latestTaskExecutor.schedule(() =>
          asyncBucketPick(
            viewMode,
            mags,
            position,
            sphericalCapRadius,
            matrix,
            logZoomStep,
            datasetConfiguration.loadingStrategy,
            rects,
          ),
        );
      }

      pickingPromise.then(
        (buffer) => {
          this.cube.markBucketsAsUnneeded();
          const bucketsWithPriorities = consumeBucketsFromArrayBuffer(
            buffer,
            this.cube,
            this.textureBucketManager.maximumCapacity,
            this.additionalCoordinates,
          );
          const buckets = bucketsWithPriorities.map(({ bucket }) => bucket);
          this.textureBucketManager.setActiveBuckets(buckets);
          // In general, pull buckets which are not available but should be sent to the GPU
          const missingBuckets = bucketsWithPriorities
            .filter(({ bucket }) => !bucket.hasData())
            .filter(({ bucket }) => magInfo.hasIndex(bucket.zoomedAddress[3]))
            .map(({ bucket, priority }) => ({
              bucket: bucket.zoomedAddress,
              priority,
            }));

          this.pullQueue.addAll(missingBuckets);
          this.pullQueue.pull();
        },
        (reason) => {
          if (reason.message !== SKIPPED_TASK_REASON) {
            throw reason;
          }
        },
      );
    }
  }

  destroy() {
    this.storePropertyUnsubscribers.forEach((fn) => fn());
    if (this.textureBucketManager != null) {
      // In some tests, this.textureBucketManager is null (even
      // though it should never be null in non-tests).
      this.textureBucketManager.destroy();
    }
    getSharedLookUpCuckooTable.clear();
    asyncBucketPick.clear();
    shaderEditor.destroy();
    this.colorCuckooTable = undefined;
  }

  /* Methods related to custom segment colors: */

  getCustomColorCuckooTable() {
    if (this.colorCuckooTable != null) {
      return this.colorCuckooTable;
    }
    if (!this.cube.isSegmentation) {
      throw new Error(
        "getCustomColorCuckooTable should not be called for non-segmentation layers.",
      );
    }
    this.colorCuckooTable = new CuckooTableVec3(CUSTOM_COLORS_TEXTURE_WIDTH);
    return this.colorCuckooTable;
  }

  listenToCustomSegmentColors() {
    let prevSegments: SegmentMap = new DiffableMap();
    const clear = () => {
      const cuckoo = this.getCustomColorCuckooTable();
      prevSegments = new DiffableMap();
      cuckoo.clear();
    };
    const ignoreCustomColors = () => {
      throttledShowTooManyCustomColorsWarning();
      clear();
    };
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getSegmentsForLayer(storeState, this.name),
        (newSegments) => {
          updateToNewSegments(newSegments);
        },
      ),
    );
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getHideUnregisteredSegmentsForLayer(storeState, this.name),
        () => {
          // Rebuild
          clear();
          const newSegments = getSegmentsForLayer(Store.getState(), this.name);
          updateToNewSegments(newSegments);
        },
      ),
    );

    function extractAdaptedBlueChannel(color: Vector3, isVisible: boolean) {
      // See the comments on the callee sites for an explanation of this logic.
      const increment = isVisible ? 1 : 0;
      return 2 * Math.floor((255 * color[2]) / 2) + increment;
    }

    const updateToNewSegments = (newSegments: SegmentMap) => {
      const cuckoo = this.getCustomColorCuckooTable();
      const hideUnregisteredSegments = getHideUnregisteredSegmentsForLayer(
        Store.getState(),
        this.name,
      );
      for (const updateAction of cachedDiffSegmentLists(this.name, prevSegments, newSegments)) {
        if (
          updateAction.name === "updateSegment" ||
          updateAction.name === "createSegment" ||
          updateAction.name === "deleteSegment" ||
          updateAction.name === "updateSegmentVisibility"
        ) {
          const { id } = updateAction.value;
          const newSegment = newSegments.getNullable(id);
          const isVisible = newSegment?.isVisible ?? !hideUnregisteredSegments;
          const color = newSegment?.color;

          if (cuckoo.entryCount >= cuckoo.getCriticalCapacity()) {
            ignoreCustomColors();
            return;
          }

          /*
           * For each segment, we have to take care that it is
           * rendered with the correct color.
           * In general, segments only need to be added to the cuckoo table,
           * if they have a custom color and/or a custom visibility.
           * If they have a custom visibility, but not a custom color,
           * [0, 0, 0] is used as a special value for that.
           * If they have a custom color, the visibility is additionally encoded
           * in the blue channel of the RGB value. See below for details.
           */
          try {
            if (!isVisible) {
              if (color == null) {
                if (hideUnregisteredSegments) {
                  // Remove from cuckoo, because the rendering defaults to
                  // hiding unregistered segments.
                  cuckoo.unset(id);
                } else {
                  // Explicitly set to [0, 0, 0] because it should be invisible
                  // (default color is chosen by shader on hover).
                  // [0, 0, 0] encodes that this segment is only listed so that
                  // the hideUnregisteredSegments behavior does not apply for it.
                  // No actual color is encoded so that the default color is used.
                  cuckoo.set(id, [0, 0, 0]);
                }
              } else {
                // The segment has a special color. Even though, the segment should
                // be invisible, the shader should still be able to render the segment
                // when it's hovered. Therefore, we encode both the actual color and the
                // invisibility state within the color attribute.
                // This is done by effectively halving the precision of the blue channel.
                // All even blue values encode "invisible". Odd values encode "visible".
                if (V3.equals(color, [0, 0, 0])) {
                  // If the user provided [0, 0, 0] as the segment's color, we have to take
                  // care so that this does not get interpreted as "use the default color".
                  // For that reason, we cast that color value to [0, 0, 2].
                  cuckoo.set(id, [0, 0, 2]);
                } else {
                  const blueChannel = extractAdaptedBlueChannel(color, false);
                  cuckoo.set(id, [255 * color[0], 255 * color[1], blueChannel]);
                }
              }
            } else if (color != null) {
              // The segment should be visible and it has a custom color.
              // We employ the same trick as above to encode color and visibility.
              // The special value of [0, 0, 0] won't be used here ever, because
              // of the + 1.
              const blueChannel = extractAdaptedBlueChannel(color, true);
              cuckoo.set(id, [255 * color[0], 255 * color[1], blueChannel]);
            } else {
              // The segment should be visible and no custom color exists for it.
              if (hideUnregisteredSegments) {
                // Explicitly set to [0, 0, 0] because it should be visible
                // (default color is chosen by shader).
                // [0, 0, 0] encodes that this segment is only listed so that
                // the hideUnregisteredSegments behavior does not apply for it.
                // No actual color is encoded so that the default color is used.
                cuckoo.set(id, [0, 0, 0]);
              } else {
                // Remove from cuckoo, because the rendering defaults to
                // showing unregistered segments.
                cuckoo.unset(id);
              }
            }
          } catch {
            ignoreCustomColors();
            return;
          }
        }
      }

      prevSegments = newSegments;
    };
  }
}
function showTooManyCustomColorsWarning() {
  Toast.warning(
    "There are too many segments with custom colors/visibilities. Default rendering will be used for now.",
  );
}

const throttledShowTooManyCustomColorsWarning = _.throttle(showTooManyCustomColorsWarning, 5000, {
  leading: true,
});
