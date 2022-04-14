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
type ShaderMaterialOptions = {
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
};
const RECOMPILATION_THROTTLE_TIME = 500;
export type Uniforms = Record<
  string,
  {
    type: "b" | "f" | "i" | "t" | "v2" | "v3" | "v4" | "tv";
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
  leastRecentlyVisibleColorLayers: Array<string>;
  oldShaderCode: string | null | undefined;

  constructor(planeID: OrthoView, isOrthogonal: boolean, shaderId: number) {
    this.planeID = planeID;
    this.isOrthogonal = isOrthogonal;
    this.shaderId = shaderId;
    this.leastRecentlyVisibleColorLayers = [];
  }

  setup() {
    this.setupUniforms();
    this.makeMaterial();
    this.attachTextures();
    return this;
  }

  stopListening() {
    this.storePropertyUnsubscribers.forEach((fn) => fn());
  }

  setupUniforms(): void {
    const addressSpaceDimensions = getAddressSpaceDimensions(
      Store.getState().temporaryConfiguration.gpuSetup.initializedGpuFactor,
    );
    this.uniforms = {
      sphericalCapRadius: {
        type: "f",
        value: 140,
      },
      globalPosition: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      anchorPoint: {
        type: "v4",
        value: new THREE.Vector3(0, 0, 0),
      },
      zoomStep: {
        type: "f",
        value: 1,
      },
      zoomValue: {
        type: "f",
        value: 1,
      },
      useBilinearFiltering: {
        type: "b",
        value: true,
      },
      isMappingEnabled: {
        type: "b",
        value: false,
      },
      mappingSize: {
        type: "f",
        value: 0,
      },
      hideUnmappedIds: {
        type: "b",
        value: false,
      },
      globalMousePosition: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      brushSizeInPixel: {
        type: "f",
        value: 0,
      },
      segmentationPatternOpacity: {
        type: "f",
        value: 40,
      },
      activeCellId: {
        type: "v4",
        value: new THREE.Vector4(0, 0, 0, 0),
      },
      isMouseInActiveViewport: {
        type: "b",
        value: false,
      },
      isMouseInCanvas: {
        type: "b",
        value: false,
      },
      showBrush: {
        type: "b",
        value: false,
      },
      viewMode: {
        type: "f",
        value: 0,
      },
      planeID: {
        type: "f",
        value: OrthoViewValues.indexOf(this.planeID),
      },
      bboxMin: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      bboxMax: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      renderBucketIndices: {
        type: "b",
        value: false,
      },
      addressSpaceDimensions: {
        type: "v3",
        value: new THREE.Vector3(...addressSpaceDimensions),
      },
      hoveredSegmentId: {
        type: "v4",
        value: new THREE.Vector4(0, 0, 0, 0),
      },
    };

    for (const dataLayer of Model.getAllLayers()) {
      const layerName = sanitizeName(dataLayer.name);
      this.uniforms[`${layerName}_maxZoomStep`] = {
        type: "f",
        value: dataLayer.cube.resolutionInfo.getHighestResolutionIndex(),
      };
      this.uniforms[`${layerName}_alpha`] = {
        type: "f",
        value: 1,
      };
      // If the `_unrenderable` uniform is true, the layer
      // cannot (and should not) be rendered in the
      // current mag.
      this.uniforms[`${layerName}_unrenderable`] = {
        type: "f",
        value: 0,
      };
    }

    for (const name of getSanitizedColorLayerNames()) {
      this.uniforms[`${name}_color`] = {
        type: "v3",
        value: DEFAULT_COLOR,
      };
      this.uniforms[`${name}_min`] = {
        type: "f",
        value: 0.0,
      };
      this.uniforms[`${name}_max`] = {
        type: "f",
        value: 1.0,
      };
      this.uniforms[`${name}_is_inverted`] = {
        type: "f",
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
        type: "tv",
        value: dataTextures,
      };
      this.uniforms[`${layerName}_data_texture_width`] = {
        type: "f",
        value: dataLayer.layerRenderingManager.textureWidth,
      };
      this.uniforms[`${layerName}_lookup_texture`] = {
        type: "t",
        value: lookUpTexture,
      };
    }

    this.attachSegmentationTextures();
  }

  attachSegmentationTextures(): void {
    const segmentationLayer = Model.getSegmentationLayerWithMappingSupport();
    const [mappingTexture, mappingLookupTexture, mappingColorTexture] =
      Model.isMappingSupported && segmentationLayer != null && segmentationLayer.mappings != null
        ? segmentationLayer.mappings.getMappingTextures() // It's important to set up the uniforms (even when they are null), since later
        : // additions to `this.uniforms` won't be properly attached otherwise.
          [null, null, null];
    this.uniforms.segmentation_mapping_texture = {
      type: "t",
      value: mappingTexture,
    };
    this.uniforms.segmentation_mapping_lookup_texture = {
      type: "t",
      value: mappingLookupTexture,
    };
    this.uniforms.segmentation_mapping_color_texture = {
      type: "t",
      value: mappingColorTexture,
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
    const oldVisibilityPerLayer = {};
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.datasetConfiguration.layers,
        (layerSettings) => {
          for (const dataLayer of Model.getAllLayers()) {
            const { elementClass } = dataLayer.cube;
            const settings = layerSettings[dataLayer.name];

            if (settings != null) {
              const isLayerEnabled = !settings.isDisabled;
              const isSegmentationLayer = dataLayer.isSegmentation;

              if (
                !isSegmentationLayer &&
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                oldVisibilityPerLayer[dataLayer.name] != null &&
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                oldVisibilityPerLayer[dataLayer.name] !== isLayerEnabled
              ) {
                if (settings.isDisabled) {
                  this.onDisableColorLayer(dataLayer.name);
                } else {
                  this.onEnableColorLayer(dataLayer.name);
                }
              }

              // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
              oldVisibilityPerLayer[dataLayer.name] = isLayerEnabled;
              const name = sanitizeName(dataLayer.name);
              this.updateUniformsForLayer(settings, name, elementClass, isSegmentationLayer);
            }
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
            this.attachSegmentationTextures();
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
            const [a, b, g, r] = Utils.convertDecToBase256(hoveredSegmentId);
            this.uniforms.hoveredSegmentId.value.set(r, g, b, a);
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
    // Convert the id into 4 bytes (little endian)
    const [a, b, g, r] = Utils.convertDecToBase256(mappedActiveCellId);
    this.uniforms.activeCellId.value.set(r, g, b, a);
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

  getLayersToRender(maximumLayerCountToRender: number): Array<string> {
    // This function determines for which layers
    // the shader code should be compiled. If the GPU supports
    // all layers, we can simply return all layers here.
    // Otherwise, we prioritize layers to render by taking
    // into account (a) which layers are activated and (b) which
    // layers were least-recently activated (but are now disabled).
    if (maximumLayerCountToRender <= 0) {
      return [];
    }

    const colorLayerNames = getSanitizedColorLayerNames();

    if (maximumLayerCountToRender >= colorLayerNames.length) {
      // We can simply render all available layers.
      return colorLayerNames;
    }

    const state = Store.getState();
    const enabledLayerNames = getEnabledLayers(state.dataset, state.datasetConfiguration, {
      onlyColorLayers: true,
    }).map((layer) => layer.name);
    const disabledLayerNames = getEnabledLayers(state.dataset, state.datasetConfiguration, {
      invert: true,
      onlyColorLayers: true,
    }).map((layer) => layer.name);
    // In case, this.leastRecentlyVisibleColorLayers does not contain all disabled layers
    // because they were already disabled on page load), append the disabled layers
    // which are not already in that array.
    // Note that the order of this array is important (earlier elements are more "recently used")
    // which is why it is important how this operation is done.
    this.leastRecentlyVisibleColorLayers = [
      ...this.leastRecentlyVisibleColorLayers,
      ..._.without(disabledLayerNames, ...this.leastRecentlyVisibleColorLayers),
    ];
    const names = enabledLayerNames
      .concat(this.leastRecentlyVisibleColorLayers)
      .slice(0, maximumLayerCountToRender)
      .sort();
    return names.map(sanitizeName);
  }

  onDisableColorLayer = (layerName: string) => {
    this.leastRecentlyVisibleColorLayers = _.without(
      this.leastRecentlyVisibleColorLayers,
      layerName,
    );
    this.leastRecentlyVisibleColorLayers = [layerName, ...this.leastRecentlyVisibleColorLayers];
    this.recomputeFragmentShader();
  };

  onEnableColorLayer = (layerName: string) => {
    this.leastRecentlyVisibleColorLayers = _.without(
      this.leastRecentlyVisibleColorLayers,
      layerName,
    );
    this.recomputeFragmentShader();
  };

  getFragmentShader(): string {
    const { initializedGpuFactor, maximumLayerCountToRender } =
      Store.getState().temporaryConfiguration.gpuSetup;
    // Don't compile code for segmentation in arbitrary mode
    const shouldRenderSegmentation = this.isOrthogonal && Model.hasSegmentationLayer();
    const colorLayerNames = this.getLayersToRender(
      maximumLayerCountToRender - (shouldRenderSegmentation ? 1 : 0),
    );
    const packingDegreeLookup = getPackingDegreeLookup();
    const segmentationLayerNames = shouldRenderSegmentation
      ? Model.getSegmentationLayers().map((layer) => sanitizeName(layer.name))
      : [];
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
