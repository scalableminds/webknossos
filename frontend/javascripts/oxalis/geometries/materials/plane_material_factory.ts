import * as THREE from "three";
import _ from "lodash";
import { BLEND_MODES, Identity4x4, OrthoView, Vector3 } from "oxalis/constants";
import {
  ViewModeValues,
  OrthoViewValues,
  OrthoViews,
  MappingStatusEnum,
  AnnotationToolEnum,
} from "oxalis/constants";
import { calculateGlobalPos, getViewportExtents } from "oxalis/model/accessors/view_mode_accessor";
import { isBrushTool } from "oxalis/model/accessors/tool_accessor";
import {
  getActiveCellId,
  getActiveSegmentationTracing,
  getActiveSegmentPosition,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getPackingDegree } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import {
  getColorLayers,
  getDataLayers,
  getByteCount,
  getElementClass,
  getDatasetBoundingBox,
  getEnabledLayers,
  getSegmentationLayerWithMappingSupport,
  getMappingInfoForSupportedLayer,
  getVisibleSegmentationLayer,
  getLayerByName,
  invertAndTranspose,
  getTransformsForLayer,
  getResolutionInfoByLayer,
  getResolutionInfo,
  getTransformsPerLayer,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getActiveMagIndicesForLayers,
  getUnrenderableLayerInfosForCurrentZoom,
  getZoomValue,
} from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { Model } from "oxalis/singletons";
import type { DatasetLayerConfiguration } from "oxalis/store";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
import app from "app";
import getMainFragmentShader, { getMainVertexShader } from "oxalis/shaders/main_data_shaders.glsl";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import type { ElementClass } from "types/api_flow_types";
import { CuckooTable } from "oxalis/model/bucket_data_handling/cuckoo_table";
import { getGlobalLayerIndexForLayerName } from "oxalis/model/bucket_data_handling/layer_rendering_manager";
import { V3 } from "libs/mjs";
import TPS3D from "libs/thin_plate_spline";

type ShaderMaterialOptions = {
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
};
const RECOMPILATION_THROTTLE_TIME = 500;
export type Uniforms = Record<
  string,
  {
    value: any;
  }
>;
const DEFAULT_COLOR = new THREE.Vector3(255, 255, 255);

function sanitizeName(name: string | null | undefined): string {
  if (name == null) {
    return "";
  }

  // Variables must start with a-z,A-Z or _. Names can contain a-z,A-Z,0-9 or _.
  // User variable names cannot start with gl_ or contain a double _.
  // Base64 encode the layer name and remove = characters to make sure variable names are valid
  return `layer_${btoa(name).replace(/=+/g, "")}`;
}

function getSanitizedColorLayerNames() {
  return getColorLayers(Store.getState().dataset).map((layer) => sanitizeName(layer.name));
}

function getTextureLayerInfos(): Record<
  string,
  { packingDegree: number; dataTextureCount: number }
> {
  const { dataset } = Store.getState();
  const layers = getDataLayers(dataset);

  // keyBy the sanitized layer name as the lookup will happen in the shader using the sanitized layer name
  const layersObject = _.keyBy(layers, (layer) => sanitizeName(layer.name));

  return _.mapValues(layersObject, (layer) => ({
    packingDegree: getPackingDegree(
      getByteCount(dataset, layer.name),
      getElementClass(dataset, layer.name),
    ),
    dataTextureCount: Model.getLayerRenderingManagerByName(layer.name).dataTextureCount,
  }));
}

class PlaneMaterialFactory {
  planeID: OrthoView;
  isOrthogonal: boolean;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'material' has no initializer and is not ... Remove this comment to see the full error message
  material: THREE.ShaderMaterial;
  uniforms: Uniforms = {};
  attributes: Record<string, any> = {};
  shaderId: number;
  storePropertyUnsubscribers: Array<() => void> = [];
  leastRecentlyVisibleLayers: Array<{ name: string; isSegmentationLayer: boolean }>;
  oldFragmentShaderCode: string | null | undefined;
  oldVertexShaderCode: string | null | undefined;
  unsubscribeSeedsFn: (() => void) | null = null;

  scaledTpsInvPerLayer: Record<string, TPS3D> = {};

  constructor(planeID: OrthoView, isOrthogonal: boolean, shaderId: number) {
    this.planeID = planeID;
    this.isOrthogonal = isOrthogonal;
    this.shaderId = shaderId;
    this.leastRecentlyVisibleLayers = [];
  }

  setup() {
    this.setupUniforms();
    this.makeMaterial();
    this.attachTextures();
    return this;
  }

  stopListening() {
    this.storePropertyUnsubscribers.forEach((fn) => fn());
    this.storePropertyUnsubscribers = [];
  }

  setupUniforms(): void {
    this.uniforms = {
      sphericalCapRadius: {
        value: 140,
      },
      is3DViewBeingRendered: {
        value: true,
      },
      globalPosition: {
        value: new THREE.Vector3(0, 0, 0),
      },
      zoomValue: {
        value: 1,
      },
      useBilinearFiltering: {
        value: true,
      },
      viewportExtent: {
        value: [0, 0],
      },
      isMappingEnabled: {
        value: false,
      },
      mappingSize: {
        value: 0,
      },
      hideUnmappedIds: {
        value: false,
      },
      globalMousePosition: {
        value: new THREE.Vector3(0, 0, 0),
      },
      activeSegmentPosition: {
        value: new THREE.Vector3(-1, -1, -1),
      },
      brushSizeInPixel: {
        value: 0,
      },
      segmentationPatternOpacity: {
        value: 40,
      },
      isMouseInActiveViewport: {
        value: false,
      },
      isMouseInCanvas: {
        value: false,
      },
      showBrush: {
        value: false,
      },
      isProofreading: {
        value: false,
      },
      viewMode: {
        value: 0,
      },
      planeID: {
        value: OrthoViewValues.indexOf(this.planeID),
      },
      bboxMin: {
        value: new THREE.Vector3(0, 0, 0),
      },
      bboxMax: {
        value: new THREE.Vector3(0, 0, 0),
      },
      renderBucketIndices: {
        value: false,
      },

      // The hovered segment id is always stored as a 64-bit (8 byte)
      // value which is why it is spread over two uniforms,
      // named as `-High` and `-Low`.
      hoveredSegmentIdHigh: {
        value: new THREE.Vector4(0, 0, 0, 0),
      },
      hoveredSegmentIdLow: {
        value: new THREE.Vector4(0, 0, 0, 0),
      },
      // The same is done for the active cell id.
      activeCellIdHigh: {
        value: new THREE.Vector4(0, 0, 0, 0),
      },
      activeCellIdLow: {
        value: new THREE.Vector4(0, 0, 0, 0),
      },
      isUnmappedSegmentHighlighted: {
        value: false,
      },
      blendMode: { value: 1.0 },
    };

    const activeMagIndices = getActiveMagIndicesForLayers(Store.getState());
    this.uniforms.activeMagIndices = {
      value: Object.values(activeMagIndices),
    };
    const nativelyRenderedLayerName =
      Store.getState().datasetConfiguration.nativelyRenderedLayerName;
    const dataset = Store.getState().dataset;
    for (const dataLayer of Model.getAllLayers()) {
      const layerName = sanitizeName(dataLayer.name);

      this.uniforms[`${layerName}_alpha`] = {
        value: 1,
      };
      this.uniforms[`${layerName}_gammaCorrectionValue`] = {
        value: 1,
      };
      // If the `_unrenderable` uniform is true, the layer
      // cannot (and should not) be rendered in the
      // current mag.
      this.uniforms[`${layerName}_unrenderable`] = {
        value: 0,
      };
      const layer = getLayerByName(dataset, dataLayer.name);

      this.uniforms[`${layerName}_transform`] = {
        value: invertAndTranspose(
          getTransformsForLayer(dataset, layer, nativelyRenderedLayerName).affineMatrix,
        ),
      };
      this.uniforms[`${layerName}_has_transform`] = {
        value: !_.isEqual(
          getTransformsForLayer(dataset, layer, nativelyRenderedLayerName).affineMatrix,
          Identity4x4,
        ),
      };
    }

    for (const name of getSanitizedColorLayerNames()) {
      this.uniforms[`${name}_color`] = {
        value: DEFAULT_COLOR,
      };
      this.uniforms[`${name}_min`] = {
        value: 0.0,
      };
      this.uniforms[`${name}_max`] = {
        value: 1.0,
      };
      this.uniforms[`${name}_is_inverted`] = {
        value: 0,
      };
    }
  }

  convertColor(color: Vector3): Vector3 {
    return [color[0] / 255, color[1] / 255, color[2] / 255];
  }

  attachTextures(): void {
    let sharedLookUpTexture;
    let sharedLookUpCuckooTable;
    // Add data and look up textures for each layer
    for (const dataLayer of Model.getAllLayers()) {
      const { name } = dataLayer;
      const [lookUpTexture, ...dataTextures] = dataLayer.layerRenderingManager.getDataTextures();
      sharedLookUpTexture = lookUpTexture;
      sharedLookUpCuckooTable = dataLayer.layerRenderingManager.getSharedLookUpCuckooTable();
      const layerName = sanitizeName(name);
      this.uniforms[`${layerName}_textures`] = {
        value: dataTextures,
      };
      this.uniforms[`${layerName}_data_texture_width`] = {
        value: dataLayer.layerRenderingManager.textureWidth,
      };
    }

    if (!sharedLookUpCuckooTable) {
      throw new Error("Empty layer list at unexpected point.");
    }

    this.uniforms.lookup_texture = {
      value: sharedLookUpTexture,
    };

    this.unsubscribeSeedsFn = sharedLookUpCuckooTable.subscribeToSeeds((seeds: number[]) => {
      this.uniforms.lookup_seeds = {
        value: seeds,
      };
    });
    const {
      CUCKOO_ENTRY_CAPACITY,
      CUCKOO_ELEMENTS_PER_ENTRY,
      CUCKOO_ELEMENTS_PER_TEXEL,
      CUCKOO_TWIDTH,
    } = sharedLookUpCuckooTable.getUniformValues();
    this.uniforms.LOOKUP_CUCKOO_ENTRY_CAPACITY = { value: CUCKOO_ENTRY_CAPACITY };
    this.uniforms.LOOKUP_CUCKOO_ELEMENTS_PER_ENTRY = { value: CUCKOO_ELEMENTS_PER_ENTRY };
    this.uniforms.LOOKUP_CUCKOO_ELEMENTS_PER_TEXEL = { value: CUCKOO_ELEMENTS_PER_TEXEL };
    this.uniforms.LOOKUP_CUCKOO_TWIDTH = { value: CUCKOO_TWIDTH };

    this.attachSegmentationMappingTextures();
    this.attachSegmentationColorTexture();
  }

  attachSegmentationMappingTextures(): void {
    const segmentationLayer = Model.getSegmentationLayerWithMappingSupport();
    const [mappingTexture, mappingLookupTexture] =
      segmentationLayer?.mappings != null
        ? segmentationLayer.mappings.getMappingTextures() // It's important to set up the uniforms (even when they are null), since later
        : // additions to `this.uniforms` won't be properly attached otherwise.
          [null, null, null];

    this.uniforms.segmentation_mapping_texture = {
      value: mappingTexture,
    };
    this.uniforms.segmentation_mapping_lookup_texture = {
      value: mappingLookupTexture,
    };
  }

  attachSegmentationColorTexture(): void {
    const segmentationLayer = Model.getVisibleSegmentationLayer();
    if (segmentationLayer == null) {
      this.uniforms.custom_color_seeds = { value: [0, 0, 0] };

      this.uniforms.CUCKOO_ENTRY_CAPACITY = { value: 0 };
      this.uniforms.CUCKOO_ELEMENTS_PER_ENTRY = { value: 0 };
      this.uniforms.CUCKOO_ELEMENTS_PER_TEXEL = { value: 0 };
      this.uniforms.CUCKOO_TWIDTH = { value: 0 };
      this.uniforms.custom_color_texture = { value: CuckooTable.getNullTexture() };
      return;
    }
    const cuckoo = segmentationLayer.layerRenderingManager.getCustomColorCuckooTable();
    const customColorTexture = cuckoo.getTexture();

    if (this.unsubscribeSeedsFn != null) {
      this.unsubscribeSeedsFn();
    }
    this.unsubscribeSeedsFn = cuckoo.subscribeToSeeds((seeds: number[]) => {
      this.uniforms.custom_color_seeds = { value: seeds };
    });
    const {
      CUCKOO_ENTRY_CAPACITY,
      CUCKOO_ELEMENTS_PER_ENTRY,
      CUCKOO_ELEMENTS_PER_TEXEL,
      CUCKOO_TWIDTH,
    } = cuckoo.getUniformValues();
    this.uniforms.CUCKOO_ENTRY_CAPACITY = { value: CUCKOO_ENTRY_CAPACITY };
    this.uniforms.CUCKOO_ELEMENTS_PER_ENTRY = { value: CUCKOO_ELEMENTS_PER_ENTRY };
    this.uniforms.CUCKOO_ELEMENTS_PER_TEXEL = { value: CUCKOO_ELEMENTS_PER_TEXEL };
    this.uniforms.CUCKOO_TWIDTH = { value: CUCKOO_TWIDTH };
    this.uniforms.custom_color_texture = {
      value: customColorTexture,
    };
  }

  makeMaterial(options?: ShaderMaterialOptions): void {
    this.startListeningForUniforms();
    const [fragmentShader, additionalUniforms] = this.getFragmentShaderWithUniforms();
    // The uniforms instance must not be changed (e.g., with
    // {...this.uniforms, ...additionalUniforms}), as this would result in
    // errors à la: Two textures of different types use the same sampler location.
    for (const [name, value] of Object.entries(additionalUniforms)) {
      this.uniforms[name] = value;
    }
    this.material = new THREE.ShaderMaterial(
      _.extend(options, {
        uniforms: this.uniforms,
        vertexShader: this.getVertexShader(),
        fragmentShader,
      }),
    );
    // @ts-expect-error ts-migrate(2739) FIXME: Type '{ derivatives: true; }' is missing the follo... Remove this comment to see the full error message
    this.material.extensions = {
      // Necessary for anti-aliasing via fwidth in shader
      // derivatives: true,
    };
    shaderEditor.addMaterial(this.shaderId, this.material);

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setGlobalPosition' does not exist on typ... Remove this comment to see the full error message
    this.material.setGlobalPosition = (x, y, z) => {
      this.uniforms.globalPosition.value.set(x, y, z);
    };

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setUseBilinearFiltering' does not exist ... Remove this comment to see the full error message
    this.material.setUseBilinearFiltering = (isEnabled) => {
      this.uniforms.useBilinearFiltering.value = isEnabled;
    };

    this.material.side = THREE.DoubleSide;
  }

  startListeningForUniforms() {
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getActiveMagIndicesForLayers(storeState),
        (activeMagIndices) => {
          this.uniforms.activeMagIndices.value = Object.values(activeMagIndices);

          // The vertex shader looks up the buckets for rendering so that the
          // fragment shader doesn't need to do so. Currently, this only works
          // for layers that don't have a transformation (otherwise, the differing
          // grids wouldn't align with each other).
          // To align the vertices with the buckets, the current magnification is
          // needed. Since the current mag can differ from layer to layer, the shader
          // needs to know which mag is safe to use.
          // For this purpose, we define the representativeMagForVertexAlignment which is
          // a virtual mag (meaning, there's not necessarily a layer with that exact
          // mag). It is derived from the layers that are not transformed by considering
          // the minimum for each axis. That way, the vertices are aligned using the
          // lowest common multiple.
          // For example, one layer might render mag 4-4-1, whereas another layer renders
          // 2-2-2. The representative mag would be 2-2-1.
          // If all layers have a transform, the representativeMagForVertexAlignment
          // isn't relevant which is why it can default to [1, 1, 1].

          let representativeMagForVertexAlignment: Vector3 = [Infinity, Infinity, Infinity];
          const state = Store.getState();
          for (const [layerName, activeMagIndex] of Object.entries(activeMagIndices)) {
            const layer = getLayerByName(state.dataset, layerName);
            const resolutionInfo = getResolutionInfo(layer.resolutions);
            // If the active mag doesn't exist, a fallback mag is likely rendered. Use that
            // to determine a representative mag.
            const suitableMagIndex = resolutionInfo.getIndexOrClosestHigherIndex(activeMagIndex);
            const suitableMag =
              suitableMagIndex != null
                ? resolutionInfo.getResolutionByIndex(suitableMagIndex)
                : null;

            const hasTransform = !_.isEqual(
              getTransformsForLayer(
                state.dataset,
                layer,
                state.datasetConfiguration.nativelyRenderedLayerName,
              ).affineMatrix,
              Identity4x4,
            );
            if (!hasTransform && suitableMag) {
              representativeMagForVertexAlignment = V3.min(
                representativeMagForVertexAlignment,
                suitableMag,
              );
            }
          }

          if (Math.max(...representativeMagForVertexAlignment) === Infinity) {
            representativeMagForVertexAlignment = [1, 1, 1];
          }
          this.uniforms.representativeMagForVertexAlignment = {
            value: representativeMagForVertexAlignment,
          };
        },
        true,
      ),
    );
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getViewportExtents(storeState),
        (extents) => {
          this.uniforms.viewportExtent.value = extents[this.planeID];
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) =>
          getUnrenderableLayerInfosForCurrentZoom(storeState).map(({ layer }) => layer),
        (unrenderableLayers) => {
          const unrenderableLayerNames = unrenderableLayers.map((l) => l.name);

          for (const dataLayer of Model.getAllLayers()) {
            const sanitizedName = sanitizeName(dataLayer.name);
            this.uniforms[`${sanitizedName}_unrenderable`].value = unrenderableLayerNames.includes(
              dataLayer.name,
            );
          }
        },
        true,
      ),
    );
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => storeState.userConfiguration.sphericalCapRadius,
        (sphericalCapRadius) => {
          this.uniforms.sphericalCapRadius.value = sphericalCapRadius;
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getResolutionInfoByLayer(storeState.dataset),
        (resolutionInfosByLayer) => {
          const allDenseResolutions = Object.values(resolutionInfosByLayer).map((resInfo) =>
            resInfo.getDenseResolutions(),
          );
          const flatResolutions = _.flattenDeep(allDenseResolutions);
          this.uniforms.allResolutions = {
            value: flatResolutions,
          };

          let cumSum = 0;
          const resolutionCountCumSum = [cumSum];
          for (const denseResolutions of allDenseResolutions) {
            cumSum += denseResolutions.length;
            resolutionCountCumSum.push(cumSum);
          }

          this.uniforms.resolutionCountCumSum = {
            value: resolutionCountCumSum,
          };
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getZoomValue(storeState.flycam),
        (zoomValue) => {
          this.uniforms.zoomValue.value = zoomValue;
        },
        true,
      ),
    );
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getMappingInfoForSupportedLayer(storeState).mappingSize,
        (mappingSize) => {
          this.uniforms.mappingSize.value = mappingSize;
        },
        true,
      ),
    );
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getMappingInfoForSupportedLayer(storeState).hideUnmappedIds,
        (hideUnmappedIds) => {
          this.uniforms.hideUnmappedIds.value = hideUnmappedIds;
        },
        true,
      ),
    );
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => storeState.temporaryConfiguration.viewMode,
        (viewMode) => {
          this.uniforms.viewMode.value = ViewModeValues.indexOf(viewMode);
        },
        true,
      ),
    );
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => storeState.viewModeData.plane.activeViewport === this.planeID,
        (isMouseInActiveViewport) => {
          this.uniforms.isMouseInActiveViewport.value = isMouseInActiveViewport;
        },
        true,
      ),
    );
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => storeState.dataset,
        (dataset) => {
          const { min, max } = getDatasetBoundingBox(dataset);
          this.uniforms.bboxMin.value.set(...min);
          this.uniforms.bboxMax.value.set(...max);
        },
        true,
      ),
    );
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => storeState.datasetConfiguration.blendMode,
        (blendMode) => {
          this.uniforms.blendMode.value = blendMode === BLEND_MODES.Additive ? 1.0 : 0.0;
        },
        true,
      ),
    );
    const oldVisibilityPerLayer: Record<string, boolean> = {};
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.datasetConfiguration.layers,
        (layerSettings) => {
          let updatedLayerVisibility = false;
          for (const dataLayer of Model.getAllLayers()) {
            const { elementClass } = dataLayer.cube;
            const settings = layerSettings[dataLayer.name];

            if (settings != null) {
              const isLayerEnabled = !settings.isDisabled;
              const isSegmentationLayer = dataLayer.isSegmentation;

              if (
                oldVisibilityPerLayer[dataLayer.name] != null &&
                oldVisibilityPerLayer[dataLayer.name] !== isLayerEnabled
              ) {
                if (settings.isDisabled) {
                  this.onDisableLayer(dataLayer.name, isSegmentationLayer);
                } else {
                  this.onEnableLayer(dataLayer.name);
                }
                updatedLayerVisibility = true;
              }

              oldVisibilityPerLayer[dataLayer.name] = isLayerEnabled;
              const name = sanitizeName(dataLayer.name);
              this.updateUniformsForLayer(settings, name, elementClass, isSegmentationLayer);
            }
          }
          if (updatedLayerVisibility) {
            this.recomputeShaders();
          }
          app.vent.emit("rerender");
        },
        true,
      ),
    );

    let oldLayerOrder: Array<string> = [];
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.datasetConfiguration.colorLayerOrder,
        (colorLayerOrder) => {
          const changedLayerOrder =
            colorLayerOrder.length !== oldLayerOrder.length ||
            colorLayerOrder.some((layerName, index) => layerName !== oldLayerOrder[index]);
          if (changedLayerOrder) {
            oldLayerOrder = [...colorLayerOrder];
            this.recomputeShaders();
          }
          app.vent.emit("rerender");
        },
        false,
      ),
    );
    if (Model.hasSegmentationLayer()) {
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => storeState.temporaryConfiguration.mousePosition,
          (globalMousePosition) => {
            if (!globalMousePosition) {
              this.uniforms.isMouseInCanvas.value = false;
              return;
            }

            const state = Store.getState();

            if (state.viewModeData.plane.activeViewport === OrthoViews.TDView) {
              return;
            }

            const [x, y, z] = calculateGlobalPos(state, {
              x: globalMousePosition[0],
              y: globalMousePosition[1],
            });
            this.uniforms.globalMousePosition.value.set(x, y, z);
            this.uniforms.isMouseInCanvas.value = true;
          },
          true,
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => getSegmentationLayerWithMappingSupport(storeState),
          (_segmentationLayer) => {
            this.attachSegmentationMappingTextures();
          },
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => getVisibleSegmentationLayer(storeState),
          (_segmentationLayer) => {
            this.attachSegmentationColorTexture();
          },
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => storeState.userConfiguration.brushSize,
          (brushSize) => {
            this.uniforms.brushSizeInPixel.value = brushSize;
          },
          true,
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => storeState.datasetConfiguration.segmentationPatternOpacity,
          (segmentationPatternOpacity) => {
            this.uniforms.segmentationPatternOpacity.value = segmentationPatternOpacity;
          },
          true,
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => storeState.temporaryConfiguration.hoveredSegmentId,
          (hoveredSegmentId) => {
            const [high, low] = Utils.convertNumberTo64Bit(hoveredSegmentId);

            this.uniforms.hoveredSegmentIdLow.value.set(...low);
            this.uniforms.hoveredSegmentIdHigh.value.set(...high);
          },
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) =>
            Utils.maybe(getActiveCellId)(getActiveSegmentationTracing(storeState)).getOrElse(0),
          () => this.updateActiveCellId(),
          true,
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => getActiveSegmentationTracing(storeState)?.activeUnmappedSegmentId,
          (activeUnmappedSegmentId) =>
            (this.uniforms.isUnmappedSegmentHighlighted.value = activeUnmappedSegmentId != null),
          true,
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) =>
            getMappingInfoForSupportedLayer(storeState).mappingStatus === MappingStatusEnum.ENABLED,
          () => this.updateActiveCellId(),
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => getMappingInfoForSupportedLayer(storeState).mapping,
          () => this.updateActiveCellId(),
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) =>
            getMappingInfoForSupportedLayer(storeState).mappingStatus ===
              MappingStatusEnum.ENABLED && // The shader should only know about the mapping when a JSON mapping exists
            getMappingInfoForSupportedLayer(storeState).mappingType === "JSON",
          (isEnabled) => {
            this.uniforms.isMappingEnabled.value = isEnabled;
          },
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => storeState.uiInformation.activeTool,
          (annotationTool) => {
            this.uniforms.showBrush.value = isBrushTool(annotationTool);
            this.uniforms.isProofreading.value = annotationTool === AnnotationToolEnum.PROOFREAD;
          },
          true,
        ),
      );
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => getActiveSegmentPosition(storeState),
          (activeSegmentPosition) => {
            if (activeSegmentPosition != null) {
              this.uniforms.activeSegmentPosition.value.set(...activeSegmentPosition);
            } else {
              this.uniforms.activeSegmentPosition.value.set(-1, -1, -1);
            }
          },
          true,
        ),
      );
    }

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) =>
          getTransformsPerLayer(
            storeState.dataset,
            storeState.datasetConfiguration.nativelyRenderedLayerName,
          ),
        (transformsPerLayer) => {
          this.scaledTpsInvPerLayer = {};
          const state = Store.getState();
          const layers = state.dataset.dataSource.dataLayers;
          for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
            const layer = layers[layerIdx];
            const name = sanitizeName(layer.name);
            const transforms = transformsPerLayer[layer.name];
            const { affineMatrix } = transforms;
            const scaledTpsInv =
              transforms.type === "thin_plate_spline" ? transforms.scaledTpsInv : null;

            if (scaledTpsInv) {
              this.scaledTpsInvPerLayer[name] = scaledTpsInv;
            } else {
              delete this.scaledTpsInvPerLayer[name];
            }

            this.uniforms[`${name}_transform`].value = invertAndTranspose(affineMatrix);
            const hasTransform = !_.isEqual(affineMatrix, Identity4x4);
            this.uniforms[`${name}_has_transform`] = {
              value: hasTransform,
            };
          }
          this.recomputeShaders();
        },
        true,
      ),
    );
  }

  updateActiveCellId() {
    const activeCellId = Utils.maybe(getActiveCellId)(
      getActiveSegmentationTracing(Store.getState()),
    ).getOrElse(0);
    const segmentationLayer = Model.getVisibleSegmentationLayer();

    if (segmentationLayer == null) {
      return;
    }

    const mappedActiveCellId = segmentationLayer.cube.mapId(activeCellId);

    const [high, low] = Utils.convertNumberTo64Bit(mappedActiveCellId);

    this.uniforms.activeCellIdLow.value.set(...low);
    this.uniforms.activeCellIdHigh.value.set(...high);
  }

  updateUniformsForLayer(
    settings: DatasetLayerConfiguration,
    name: string,
    elementClass: ElementClass,
    isSegmentationLayer: boolean,
  ): void {
    const { alpha, intensityRange, isDisabled, isInverted, gammaCorrectionValue } = settings;

    // In UnsignedByte textures the byte values are scaled to [0, 1], in Float textures they are not
    if (!isSegmentationLayer) {
      const divisor = elementClass === "float" ? 1 : 255;
      if (intensityRange) {
        this.uniforms[`${name}_min`].value = intensityRange[0] / divisor;
        this.uniforms[`${name}_max`].value = intensityRange[1] / divisor;
      }
      this.uniforms[`${name}_is_inverted`].value = isInverted ? 1.0 : 0;

      if (settings.color != null) {
        const color = this.convertColor(settings.color);
        this.uniforms[`${name}_color`].value = new THREE.Vector3(...color);
      }
    }

    this.uniforms[`${name}_alpha`].value = isDisabled ? 0 : alpha / 100;
    this.uniforms[`${name}_gammaCorrectionValue`].value = gammaCorrectionValue;
  }

  getMaterial(): THREE.ShaderMaterial {
    return this.material;
  }

  recomputeShaders = _.throttle(() => {
    if (this.material == null) {
      return;
    }
    const [newFragmentShaderCode, additionalUniforms] = this.getFragmentShaderWithUniforms();
    for (const [name, value] of Object.entries(additionalUniforms)) {
      this.uniforms[name] = value;
    }

    const newVertexShaderCode = this.getVertexShader();

    // Comparing to this.material.fragmentShader does not work. The code seems
    // to be modified by a third party.
    if (
      this.oldFragmentShaderCode != null &&
      this.oldFragmentShaderCode === newFragmentShaderCode &&
      this.oldVertexShaderCode != null &&
      this.oldVertexShaderCode === newVertexShaderCode
    ) {
      return;
    }

    this.oldFragmentShaderCode = newFragmentShaderCode;
    this.oldVertexShaderCode = newVertexShaderCode;
    this.material.fragmentShader = newFragmentShaderCode;
    this.material.vertexShader = newVertexShaderCode;
    this.material.needsUpdate = true;
    app.vent.emit("rerender");
  }, RECOMPILATION_THROTTLE_TIME);

  getLayersToRender(
    maximumLayerCountToRender: number,
  ): [Array<string>, Array<string>, Array<string>, number] {
    // This function determines for which layers
    // the shader code should be compiled. If the GPU supports
    // all layers, we can simply return all layers here.
    // Otherwise, we prioritize layers to render by taking
    // into account (a) which layers are activated and (b) which
    // layers were least-recently activated (but are now disabled).
    // The first array contains the color layer names and the second the segmentation layer names.
    // The third parameter returns the number of globally available layers (this is not always equal
    // to the sum of the lengths of the first two arrays, as not all layers might be rendered.)
    const state = Store.getState();
    const allSanitizedOrderedColorLayerNames =
      state.datasetConfiguration.colorLayerOrder.map(sanitizeName);
    const colorLayerNames = getSanitizedColorLayerNames();
    const segmentationLayerNames = Model.getSegmentationLayers().map((layer) =>
      sanitizeName(layer.name),
    );
    const globalLayerCount = colorLayerNames.length + segmentationLayerNames.length;
    if (maximumLayerCountToRender <= 0) {
      return [[], [], [], globalLayerCount];
    }

    if (maximumLayerCountToRender >= globalLayerCount) {
      // We can simply render all available layers.
      return [
        colorLayerNames,
        segmentationLayerNames,
        allSanitizedOrderedColorLayerNames,
        globalLayerCount,
      ];
    }

    const enabledLayers = getEnabledLayers(state.dataset, state.datasetConfiguration, {}).map(
      ({ name, category }) => ({ name, isSegmentationLayer: category === "segmentation" }),
    );
    const disabledLayers = getEnabledLayers(state.dataset, state.datasetConfiguration, {
      invert: true,
    }).map(({ name, category }) => ({ name, isSegmentationLayer: category === "segmentation" }));
    // In case, this.leastRecentlyVisibleLayers does not contain all disabled layers
    // because they were already disabled on page load), append the disabled layers
    // which are not already in that array.
    // Note that the order of this array is important (earlier elements are more "recently used")
    // which is why it is important how this operation is done.
    this.leastRecentlyVisibleLayers = [
      ...this.leastRecentlyVisibleLayers,
      ...disabledLayers.filter(
        ({ name }) =>
          !this.leastRecentlyVisibleLayers.some((otherLayer) => otherLayer.name === name),
      ),
    ];

    const names = enabledLayers
      .concat(this.leastRecentlyVisibleLayers)
      .slice(0, maximumLayerCountToRender)
      .sort();

    const [sanitizedColorLayerNames, sanitizedSegmentationLayerNames] = _.partition(
      names,
      ({ isSegmentationLayer }) => !isSegmentationLayer,
    ).map((layers) => layers.map(({ name }) => sanitizeName(name)));
    const colorNameSet = new Set(sanitizedColorLayerNames);

    return [
      sanitizedColorLayerNames,
      sanitizedSegmentationLayerNames,
      allSanitizedOrderedColorLayerNames.filter((name) => colorNameSet.has(name)),
      globalLayerCount,
    ];
  }

  onDisableLayer = (layerName: string, isSegmentationLayer: boolean) => {
    this.leastRecentlyVisibleLayers = this.leastRecentlyVisibleLayers.filter(
      (entry) => entry.name !== layerName,
    );
    this.leastRecentlyVisibleLayers = [
      { name: layerName, isSegmentationLayer },
      ...this.leastRecentlyVisibleLayers,
    ];
  };

  onEnableLayer = (layerName: string) => {
    this.leastRecentlyVisibleLayers = this.leastRecentlyVisibleLayers.filter(
      (entry) => entry.name !== layerName,
    );
  };

  getFragmentShaderWithUniforms(): [string, Uniforms] {
    const { maximumLayerCountToRender } = Store.getState().temporaryConfiguration.gpuSetup;
    const [colorLayerNames, segmentationLayerNames, orderedColorLayerNames, globalLayerCount] =
      this.getLayersToRender(maximumLayerCountToRender);

    const availableLayerNames = colorLayerNames.concat(segmentationLayerNames);

    const availableLayerIndexToGlobalLayerIndex = availableLayerNames.map((layerName) =>
      getGlobalLayerIndexForLayerName(layerName, sanitizeName),
    );

    const textureLayerInfos = getTextureLayerInfos();
    const { dataset } = Store.getState();
    const datasetScale = dataset.dataSource.scale;
    const code = getMainFragmentShader({
      globalLayerCount,
      orderedColorLayerNames,
      colorLayerNames,
      segmentationLayerNames,
      textureLayerInfos,
      resolutionsCount: this.getTotalResolutionCount(),
      datasetScale,
      isOrthogonal: this.isOrthogonal,
      tpsTransformPerLayer: this.scaledTpsInvPerLayer,
    });
    return [
      code,
      { availableLayerIndexToGlobalLayerIndex: { value: availableLayerIndexToGlobalLayerIndex } },
    ];
  }

  getTotalResolutionCount(): number {
    const storeState = Store.getState();
    const allDenseResolutions = Object.values(getResolutionInfoByLayer(storeState.dataset)).map(
      (resInfo) => resInfo.getDenseResolutions(),
    );
    const flatResolutions = _.flatten(allDenseResolutions);
    return flatResolutions.length;
  }

  getVertexShader(): string {
    const { maximumLayerCountToRender } = Store.getState().temporaryConfiguration.gpuSetup;
    const [colorLayerNames, segmentationLayerNames, orderedColorLayerNames, globalLayerCount] =
      this.getLayersToRender(maximumLayerCountToRender);

    const textureLayerInfos = getTextureLayerInfos();
    const { dataset } = Store.getState();
    const datasetScale = dataset.dataSource.scale;

    return getMainVertexShader({
      globalLayerCount,
      orderedColorLayerNames,
      colorLayerNames,
      segmentationLayerNames,
      textureLayerInfos,
      resolutionsCount: this.getTotalResolutionCount(),
      datasetScale,
      isOrthogonal: this.isOrthogonal,
      tpsTransformPerLayer: this.scaledTpsInvPerLayer,
    });
  }
}

export default PlaneMaterialFactory;
