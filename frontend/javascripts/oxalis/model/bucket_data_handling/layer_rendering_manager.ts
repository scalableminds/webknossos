import * as THREE from "three";
import _ from "lodash";
import memoizeOne from "memoize-one";
import { Area, Identity4x4 } from "oxalis/model/accessors/flycam_accessor";
import { getAreasFromState, getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { M4x4, Matrix4x4, V3 } from "libs/mjs";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import { map3 } from "libs/utils";
import {
  getResolutions,
  getByteCount,
  getElementClass,
  isLayerVisible,
  getLayerByName,
  getResolutionInfo,
  getDatasetResolutionInfo,
  getColorLayers,
} from "oxalis/model/accessors/dataset_accessor";
import AsyncBucketPickerWorker from "oxalis/workers/async_bucket_picker.worker";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import LatestTaskExecutor, { SKIPPED_TASK_REASON } from "libs/latest_task_executor";
import type PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import Store, { SegmentMap } from "oxalis/store";
import TextureBucketManager from "oxalis/model/bucket_data_handling/texture_bucket_manager";
import UpdatableTexture from "libs/UpdatableTexture";
import type { ViewMode, OrthoViewMap, Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import window from "libs/window";
import DiffableMap from "libs/diffable_map";
import { CuckooTable } from "./cuckoo_table";
import { listenToStoreProperty } from "../helpers/listener_helpers";
import { cachedDiffSegmentLists } from "../sagas/volumetracing_saga";
import { getSegmentsForLayer } from "../accessors/volumetracing_accessor";
import { getViewportRects } from "../accessors/view_mode_accessor";
import { CuckooTableVec5 } from "./cuckoo_table_vec5";
import { Model } from "oxalis/singletons";

const CUSTOM_COLORS_TEXTURE_WIDTH = 512;

const asyncBucketPickRaw = createWorker(AsyncBucketPickerWorker);
const asyncBucketPick: typeof asyncBucketPickRaw = memoizeOne(
  asyncBucketPickRaw,
  (oldArgs, newArgs) => _.isEqual(oldArgs, newArgs),
);
const dummyBuffer = new ArrayBuffer(0);
export type EnqueueFunction = (arg0: Vector4, arg1: number) => void;

const getLookUpCuckooTable = memoizeOne(() => new CuckooTableVec5(256));

// each index of the returned Vector3 is either -1 or +1.
function getSubBucketLocality(position: Vector3, resolution: Vector3): Vector3 {
  // E.g., modAndDivide(63, 32) === 31 / 32 === ~0.97
  const modAndDivide = (a: number, b: number) => (a % b) / b;

  const roundToNearestBucketBoundary = (pos: Vector3, dimension: 0 | 1 | 2) => {
    const bucketExtentInVoxel = constants.BUCKET_WIDTH * resolution[dimension];
    // Math.round returns 0 or 1 which will be mapped to -1 or 1
    return Math.round(modAndDivide(pos[dimension], bucketExtentInVoxel)) * 2 - 1;
  };

  return map3((_pos, idx) => roundToNearestBucketBoundary(position, idx), position);
}

function consumeBucketsFromArrayBuffer(
  buffer: ArrayBuffer,
  cube: DataCube,
  capacity: number,
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

    const bucketAddress = [
      uint32Array[currentBufferIndex],
      uint32Array[currentBufferIndex + 1],
      uint32Array[currentBufferIndex + 2],
      uint32Array[currentBufferIndex + 3],
    ];
    const priority = uint32Array[currentBufferIndex + 4];
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number[]' is not assignable to p... Remove this comment to see the full error message
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
  const allColorLayers = getColorLayers(Store.getState().dataset);
  let layerIndex = allColorLayers.findIndex((layer) => sanitizer(layer.name) === layerName);

  if (layerIndex < 0) {
    const segmentationLayers = Model.getSegmentationLayers();
    const segLayerIndex = segmentationLayers.findIndex(
      (layer) => sanitizer(layer.name) === layerName,
    );
    if (segLayerIndex < 0) {
      throw new Error("Could not determine segmentation layer index");
    }
    layerIndex = allColorLayers.length + segLayerIndex;
  }
  return layerIndex;
}

export default class LayerRenderingManager {
  lastSphericalCapRadius: number | undefined;
  // Indicates whether the current position is closer to the previous or next bucket for each dimension
  // For example, if the current position is [31, 10, 25] the value would be [1, -1, 1]
  lastSubBucketLocality: Vector3 = [-1, -1, -1];
  lastAreas: OrthoViewMap<Area> | undefined;
  lastZoomedMatrix: Matrix4x4 | undefined;
  lastViewMode: ViewMode | undefined;
  lastIsVisible: boolean | undefined;
  textureBucketManager!: TextureBucketManager;
  textureWidth: number;
  cube: DataCube;
  pullQueue: PullQueue;
  dataTextureCount: number;
  name: string;
  needsRefresh: boolean = false;
  currentBucketPickerTick: number = 0;
  latestTaskExecutor: LatestTaskExecutor<ArrayBuffer> = new LatestTaskExecutor();

  cuckooTable: CuckooTable | undefined;
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
    // @ts-ignore
    window.needsRerender = true;
  }

  setupDataTextures(): void {
    const { dataset } = Store.getState();
    const bytes = getByteCount(dataset, this.name);
    const elementClass = getElementClass(dataset, this.name);
    this.textureBucketManager = new TextureBucketManager(
      this.textureWidth,
      this.dataTextureCount,
      bytes,
      elementClass,
    );

    const layerIndex = getGlobalLayerIndexForLayerName(this.name);

    this.textureBucketManager.setupDataTextures(bytes, getLookUpCuckooTable(), layerIndex);
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

  getLookUpCuckooTable() {
    return getLookUpCuckooTable();
  }

  updateDataTextures(position: Vector3, logZoomStep: number): void {
    const state = Store.getState();
    const { dataset, datasetConfiguration } = state;
    const layer = getLayerByName(dataset, this.name);
    const resolutionInfo = getResolutionInfo(layer.resolutions);
    const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
    const maximumResolutionIndex = resolutionInfo.getHighestResolutionIndex();

    if (logZoomStep > maximumResolutionIndex) {
      // Don't render anything if the zoomStep is too high
      this.textureBucketManager.setActiveBuckets([]);
      return;
    }

    const resolutions = getResolutions(dataset);
    const subBucketLocality = getSubBucketLocality(
      position,
      resolutionInfo.getResolutionByIndexWithFallback(logZoomStep, datasetResolutionInfo),
    );
    const areas = getAreasFromState(state);

    const layerMatrix = layer.transformMatrix || Identity4x4;

    const matrix = M4x4.scale1(
      state.flycam.zoomStep,
      M4x4.mul(layerMatrix, state.flycam.currentMatrix),
    );

    const { viewMode } = state.temporaryConfiguration;
    const isArbitrary = constants.MODES_ARBITRARY.includes(viewMode);
    const { sphericalCapRadius } = state.userConfiguration;
    const isVisible = isLayerVisible(dataset, this.name, datasetConfiguration, viewMode);

    if (
      !_.isEqual(areas, this.lastAreas) ||
      !_.isEqual(subBucketLocality, this.lastSubBucketLocality) ||
      !_.isEqual(this.lastZoomedMatrix, matrix) ||
      viewMode !== this.lastViewMode ||
      sphericalCapRadius !== this.lastSphericalCapRadius ||
      isVisible !== this.lastIsVisible ||
      this.needsRefresh
    ) {
      this.lastSubBucketLocality = subBucketLocality;
      this.lastAreas = areas;
      this.lastZoomedMatrix = matrix;
      this.lastViewMode = viewMode;
      this.lastSphericalCapRadius = sphericalCapRadius;
      this.lastIsVisible = isVisible;
      this.needsRefresh = false;
      this.currentBucketPickerTick++;
      this.pullQueue.clear();
      let pickingPromise: Promise<ArrayBuffer> = Promise.resolve(dummyBuffer);

      if (isVisible) {
        const { initializedGpuFactor } = state.temporaryConfiguration.gpuSetup;

        const rects = getViewportRects(Store.getState());

        pickingPromise = this.latestTaskExecutor.schedule(() =>
          asyncBucketPick(
            viewMode,
            resolutions,
            position,
            sphericalCapRadius,
            matrix,
            logZoomStep,
            datasetConfiguration.loadingStrategy,
            areas,
            rects,
            subBucketLocality,
            initializedGpuFactor,
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
          );
          const buckets = bucketsWithPriorities.map(({ bucket }) => bucket);
          this.textureBucketManager.setActiveBuckets(buckets);
          // In general, pull buckets which are not available but should be sent to the GPU
          const missingBuckets = bucketsWithPriorities
            .filter(({ bucket }) => !bucket.hasData())
            .filter(({ bucket }) => resolutionInfo.hasIndex(bucket.zoomedAddress[3]))
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
    this.cuckooTable = new CuckooTable(CUSTOM_COLORS_TEXTURE_WIDTH);
    return this.cuckooTable;
  }

  listenToCustomSegmentColors() {
    let prevSegments: SegmentMap = new DiffableMap();
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getSegmentsForLayer(storeState, this.name),
        (newSegments) => {
          const cuckoo = this.getCustomColorCuckooTable();
          for (const updateAction of cachedDiffSegmentLists(prevSegments, newSegments)) {
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
