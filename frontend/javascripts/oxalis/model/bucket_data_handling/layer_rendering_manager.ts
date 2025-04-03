import app from "app";
import type UpdatableTexture from "libs/UpdatableTexture";
import LatestTaskExecutor, { SKIPPED_TASK_REASON } from "libs/async/latest_task_executor";
import { CuckooTableVec3 } from "libs/cuckoo/cuckoo_table_vec3";
import { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";
import DiffableMap from "libs/diffable_map";
import { M4x4, type Matrix4x4 } from "libs/mjs";
import { map3 } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { BucketAddress, Vector3, Vector4, ViewMode } from "oxalis/constants";
import {
  getElementClass,
  getLayerByName,
  getMagInfo,
  isLayerVisible,
} from "oxalis/model/accessors/dataset_accessor";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import type PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import TextureBucketManager from "oxalis/model/bucket_data_handling/texture_bucket_manager";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import Store, { type PlaneRects, type SegmentMap } from "oxalis/store";
import AsyncBucketPickerWorker from "oxalis/workers/async_bucket_picker.worker";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import type * as THREE from "three";
import type { AdditionalCoordinate } from "types/api_flow_types";
import {
  getTransformsForLayer,
  invertAndTranspose,
} from "../accessors/dataset_layer_transformation_accessor";
import { getViewportRects } from "../accessors/view_mode_accessor";
import { getSegmentsForLayer } from "../accessors/volumetracing_accessor";
import { listenToStoreProperty } from "../helpers/listener_helpers";
import { cachedDiffSegmentLists } from "../sagas/volumetracing_saga";

const CUSTOM_COLORS_TEXTURE_WIDTH = 512;
// 256**2 (entries) * 0.25 (load capacity) / 8 (layers) == 2048 buckets/layer
const LOOKUP_CUCKOO_TEXTURE_WIDTH = 256;

const asyncBucketPickRaw = createWorker(AsyncBucketPickerWorker);
const asyncBucketPick: typeof asyncBucketPickRaw = memoizeOne(
  asyncBucketPickRaw,
  (oldArgs, newArgs) => _.isEqual(oldArgs, newArgs),
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

  cuckooTable: CuckooTableVec3 | undefined;
  storePropertyUnsubscribers: Array<() => void> = [];

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

  getDataTextures(): Array<THREE.DataTexture | UpdatableTexture> {
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
  }

  /* Methods related to custom segment colors: */

  getCustomColorCuckooTable() {
    if (this.cuckooTable != null) {
      return this.cuckooTable;
    }
    if (!this.cube.isSegmentation) {
      throw new Error(
        "getCustomColorCuckooTable should not be called for non-segmentation layers.",
      );
    }
    this.cuckooTable = new CuckooTableVec3(CUSTOM_COLORS_TEXTURE_WIDTH);
    return this.cuckooTable;
  }

  listenToCustomSegmentColors() {
    let prevSegments: SegmentMap = new DiffableMap();
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getSegmentsForLayer(storeState, this.name),
        (newSegments) => {
          const cuckoo = this.getCustomColorCuckooTable();
          for (const updateAction of cachedDiffSegmentLists(this.name, prevSegments, newSegments)) {
            if (
              updateAction.name === "updateSegment" ||
              updateAction.name === "createSegment" ||
              updateAction.name === "deleteSegment"
            ) {
              const { id } = updateAction.value;
              const color = "color" in updateAction.value ? updateAction.value.color : null;
              if (color != null) {
                cuckoo.set(
                  id,
                  map3((el) => el * 255, color),
                );
              } else {
                cuckoo.unset(id);
              }
            }
          }

          prevSegments = newSegments;
        },
      ),
    );
  }
}
