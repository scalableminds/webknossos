import * as THREE from "three";
import _ from "lodash";
import type { OrthoView, Vector3 } from "oxalis/constants";
import { ViewModeValues, OrthoViewValues, OrthoViews, MappingStatusEnum } from "oxalis/constants";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { isBrushTool } from "oxalis/model/accessors/tool_accessor";
import {
  getActiveCellId,
  getActiveSegmentationTracing,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getAddressSpaceDimensions,
  getLookupBufferSize,
  getPackingDegree,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import {
  getColorLayers,
  getDataLayers,
  getResolutions,
  getByteCount,
  getElementClass,
  getBoundaries,
  getEnabledLayers,
  getUnrenderableLayerInfosForCurrentZoom,
  getSegmentationLayerWithMappingSupport,
  getMappingInfoForSupportedLayer,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { getRequestLogZoomStep, getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import Model from "oxalis/model";
import type { DatasetLayerConfiguration } from "oxalis/store";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
import app from "app";
import getMainFragmentShader from "oxalis/shaders/main_data_fragment.glsl";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import type { ElementClass } from "types/api_flow_types";
import { CuckooTable } from "oxalis/model/bucket_data_handling/cuckoo_table";

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

function getPackingDegreeLookup(): Record<string, number> {
  const { dataset } = Store.getState();
  const layers = getDataLayers(dataset);

  // keyBy the sanitized layer name as the lookup will happen in the shader using the sanitized layer name
  const layersObject = _.keyBy(layers, (layer) => sanitizeName(layer.name));

  return _.mapValues(layersObject, (layer) =>
    getPackingDegree(getByteCount(dataset, layer.name), getElementClass(dataset, layer.name)),
  );
}

class PlaneMaterialFactory {
  planeID: OrthoView;
  isOrthogonal: boolean;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'material' has no initializer and is not ... Remove this comment to see the full error message
  material: THREE.ShaderMaterial;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'uniforms' has no initializer and is not ... Remove this comment to see the full error message
  uniforms: Uniforms;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'attributes' has no initializer and is no... Remove this comment to see the full error message
  attributes: Record<string, any>;
  shaderId: number;
  storePropertyUnsubscribers: Array<() => void> = [];
  leastRecentlyVisibleLayers: Array<{ name: string; isSegmentationLayer: boolean }>;
  oldShaderCode: string | null | undefined;
  unsubscribeSeedsFn: (() => void) | null = null;

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
    const addressSpaceDimensions = getAddressSpaceDimensions(
      Store.getState().temporaryConfiguration.gpuSetup.initializedGpuFactor,
    );
    this.uniforms = {
      sphericalCapRadius: {
        value: 140,
      },
      globalPosition: {
        value: new THREE.Vector3(0, 0, 0),
      },
      anchorPoint: {
        value: new THREE.Vector3(0, 0, 0),
      },
      zoomStep: {
        value: 1,
      },
      zoomValue: {
        value: 1,
      },
      useBilinearFiltering: {
        value: true,
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
      addressSpaceDimensions: {
        value: new THREE.Vector3(...addressSpaceDimensions),
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
    };

    for (const dataLayer of Model.getAllLayers()) {
      const layerName = sanitizeName(dataLayer.name);
      this.uniforms[`${layerName}_maxZoomStep`] = {
        value: dataLayer.cube.resolutionInfo.getHighestResolutionIndex(),
      };
      this.uniforms[`${layerName}_alpha`] = {
        value: 1,
      };
      // If the `_unrenderable` uniform is true, the layer
      // cannot (and should not) be rendered in the
      // current mag.
      this.uniforms[`${layerName}_unrenderable`] = {
        value: 0,
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
    // Add data and look up textures for each layer
    for (const dataLayer of Model.getAllLayers()) {
      const { name } = dataLayer;
      const [lookUpTexture, ...dataTextures] = dataLayer.layerRenderingManager.getDataTextures();
      const layerName = sanitizeName(name);
      this.uniforms[`${layerName}_textures`] = {
        value: dataTextures,
      };
      this.uniforms[`${layerName}_data_texture_width`] = {
        value: dataLayer.layerRenderingManager.textureWidth,
      };
      this.uniforms[`${layerName}_lookup_texture`] = {
        value: lookUpTexture,
      };
    }

    this.attachSegmentationMappingTextures();
    this.attachSegmentationColorTexture();
  }

  attachSegmentationMappingTextures(): void {
    const segmentationLayer = Model.getSegmentationLayerWithMappingSupport();
    const [mappingTexture, mappingLookupTexture] =
      Model.isMappingSupported && segmentationLayer != null && segmentationLayer.mappings != null
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
      seeds.forEach((seed, idx) => {
        this.uniforms[`seed${idx}`] = {
          value: seed,
        };
      });
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
    this.material = new THREE.ShaderMaterial(
      _.extend(options, {
        uniforms: this.uniforms,
        vertexShader: this.getVertexShader(),
        fragmentShader: this.getFragmentShader(),
      }),
    );
    // @ts-expect-error ts-migrate(2739) FIXME: Type '{ derivatives: true; }' is missing the follo... Remove this comment to see the full error message
    this.material.extensions = {
      // Necessary for anti-aliasing via fwidth in shader
      derivatives: true,
    };
    shaderEditor.addMaterial(this.shaderId, this.material);

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setGlobalPosition' does not exist on typ... Remove this comment to see the full error message
    this.material.setGlobalPosition = (x, y, z) => {
      this.uniforms.globalPosition.value.set(x, y, z);
    };

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setAnchorPoint' does not exist on type '... Remove this comment to see the full error message
    this.material.setAnchorPoint = ([x, y, z]) => {
      this.uniforms.anchorPoint.value.set(x, y, z);
    };

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setUseBilinearFiltering' does not exist ... Remove this comment to see the full error message
    this.material.setUseBilinearFiltering = (isEnabled) => {
      this.uniforms.useBilinearFiltering.value = isEnabled;
    };

    this.material.side = THREE.DoubleSide;
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getRequestLogZoomStep(storeState),
        (zoomStep) => {
          this.uniforms.zoomStep.value = zoomStep;
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
          const { lowerBoundary, upperBoundary } = getBoundaries(dataset);
          this.uniforms.bboxMin.value.set(...lowerBoundary);
          this.uniforms.bboxMax.value.set(...upperBoundary);
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
            this.recomputeFragmentShader();
          }
          // TODO: Needed?
          app.vent.trigger("rerender");
        },
        true,
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
          },
          true,
        ),
      );
    }
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
    const { alpha, intensityRange, isDisabled, isInverted } = settings;

    // In UnsignedByte textures the byte values are scaled to [0, 1], in Float textures they are not
    if (!isSegmentationLayer) {
      const divisor = elementClass === "float" ? 1 : 255;
      this.uniforms[`${name}_min`].value = intensityRange[0] / divisor;
      this.uniforms[`${name}_max`].value = intensityRange[1] / divisor;
      this.uniforms[`${name}_is_inverted`].value = isInverted ? 1.0 : 0;

      if (settings.color != null) {
        const color = this.convertColor(settings.color);
        this.uniforms[`${name}_color`].value = new THREE.Vector3(...color);
      }
    }

    this.uniforms[`${name}_alpha`].value = isDisabled ? 0 : alpha / 100;
  }

  getMaterial(): THREE.ShaderMaterial {
    return this.material;
  }

  recomputeFragmentShader = _.throttle(() => {
    const newShaderCode = this.getFragmentShader();

    // Comparing to this.material.fragmentShader does not work. The code seems
    // to be modified by a third party.
    if (this.oldShaderCode != null && this.oldShaderCode === newShaderCode) {
      return;
    }

    this.oldShaderCode = newShaderCode;
    this.material.fragmentShader = newShaderCode;
    this.material.needsUpdate = true;
    // @ts-ignore
    window.needsRerender = true;
  }, RECOMPILATION_THROTTLE_TIME);

  getLayersToRender(maximumLayerCountToRender: number): [Array<string>, Array<string>] {
    // This function determines for which layers
    // the shader code should be compiled. If the GPU supports
    // all layers, we can simply return all layers here.
    // Otherwise, we prioritize layers to render by taking
    // into account (a) which layers are activated and (b) which
    // layers were least-recently activated (but are now disabled).
    // The first array contains the color layer names and the second the segmentation layer names.
    if (maximumLayerCountToRender <= 0) {
      return [[], []];
    }

    const colorLayerNames = getSanitizedColorLayerNames();
    const segmentationLayerNames = Model.getSegmentationLayers().map((layer) =>
      sanitizeName(layer.name),
    );

    if (maximumLayerCountToRender >= colorLayerNames.length + segmentationLayerNames.length) {
      // We can simply render all available layers.
      return [colorLayerNames, segmentationLayerNames];
    }

    const state = Store.getState();
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

    return [sanitizedColorLayerNames, sanitizedSegmentationLayerNames];
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

  getFragmentShader(): string {
    const { initializedGpuFactor, maximumLayerCountToRender } =
      Store.getState().temporaryConfiguration.gpuSetup;
    // Don't compile code for segmentation in arbitrary mode
    const [colorLayerNames, segmentationLayerNames] =
      this.getLayersToRender(maximumLayerCountToRender);
    const packingDegreeLookup = getPackingDegreeLookup();
    const { dataset } = Store.getState();
    const datasetScale = dataset.dataSource.scale;
    const lookupTextureWidth = getLookupBufferSize(initializedGpuFactor);
    return getMainFragmentShader({
      colorLayerNames,
      segmentationLayerNames,
      packingDegreeLookup,
      isMappingSupported: Model.isMappingSupported,
      // Todo: this is not computed per layer. See #4018
      dataTextureCountPerLayer: Model.maximumTextureCountForLayer,
      resolutions: getResolutions(dataset),
      datasetScale,
      isOrthogonal: this.isOrthogonal,
      lookupTextureWidth,
    });
  }

  getVertexShader(): string {
    return `
precision highp float;

varying vec4 worldCoord;
varying vec4 modelCoord;
varying vec2 vUv;
varying mat4 savedModelMatrix;

void main() {
  vUv = uv;
  modelCoord = vec4(position, 1.0);
  savedModelMatrix = modelMatrix;
  worldCoord = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
  }
}

export default PlaneMaterialFactory;
