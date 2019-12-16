// @flow
import * as THREE from "three";
import _ from "lodash";

import {
  ViewModeValues,
  type OrthoView,
  OrthoViewValues,
  OrthoViews,
  type Vector3,
  volumeToolEnumToIndex,
} from "oxalis/constants";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getActiveCellId, getVolumeTool } from "oxalis/model/accessors/volumetracing_accessor";
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
} from "oxalis/model/accessors/dataset_accessor";
import { getRequestLogZoomStep, getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import Model from "oxalis/model";
import Store, { type DatasetLayerConfiguration } from "oxalis/store";
import * as Utils from "libs/utils";
import app from "app";
import getMainFragmentShader from "oxalis/shaders/main_data_fragment.glsl";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import { type ElementClass } from "admin/api_flow_types";

type ShaderMaterialOptions = {
  polygonOffset?: boolean,
  polygonOffsetFactor?: number,
  polygonOffsetUnits?: number,
};

export type Uniforms = {
  [key: string]: {
    type: "b" | "f" | "i" | "t" | "v2" | "v3" | "v4" | "tv",
    value: any,
  },
};

const DEFAULT_COLOR = new THREE.Vector3([255, 255, 255]);

function sanitizeName(name: ?string): string {
  if (name == null) {
    return "";
  }
  // Variables must start with a-z,A-Z or _. Names can contain a-z,A-Z,0-9 or _.
  // User variable names cannot start with gl_ or contain a double _.
  // Base64 encode the layer name and remove = characters to make sure variable names are valid
  return `layer_${btoa(name).replace(/=+/g, "")}`;
}

function getColorLayerNames() {
  return getColorLayers(Store.getState().dataset).map(layer => sanitizeName(layer.name));
}

function getPackingDegreeLookup(): { [string]: number } {
  const { dataset } = Store.getState();
  const layers = getDataLayers(dataset);
  // keyBy the sanitized layer name as the lookup will happen in the shader using the sanitized layer name
  const layersObject = _.keyBy(layers, layer => sanitizeName(layer.name));
  return _.mapValues(layersObject, layer =>
    getPackingDegree(getByteCount(dataset, layer.name), getElementClass(dataset, layer.name)),
  );
}

class PlaneMaterialFactory {
  planeID: OrthoView;
  isOrthogonal: boolean;
  material: THREE.ShaderMaterial;
  uniforms: Uniforms;
  attributes: Object;
  shaderId: number;
  storePropertyUnsubscribers: Array<() => void> = [];

  constructor(planeID: OrthoView, isOrthogonal: boolean, shaderId: number) {
    this.planeID = planeID;
    this.isOrthogonal = isOrthogonal;
    this.shaderId = shaderId;
  }

  setup() {
    this.setupUniforms();
    this.makeMaterial();
    this.attachTextures();
    return this;
  }

  stopListening() {
    this.storePropertyUnsubscribers.forEach(fn => fn());
  }

  setupUniforms(): void {
    const addressSpaceDimensions = getAddressSpaceDimensions(
      Store.getState().temporaryConfiguration.gpuSetup.initializedGpuFactor,
    );
    this.uniforms = {
      alpha: {
        type: "f",
        value: 0,
      },
      highlightHoveredCellId: {
        type: "b",
        value: true,
      },
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
      activeVolumeToolIndex: {
        type: "f",
        value: 0,
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
      hoveredIsosurfaceId: {
        type: "v4",
        value: new THREE.Vector4(0, 0, 0, 0),
      },
    };

    for (const dataLayer of Model.getAllLayers()) {
      this.uniforms[`${sanitizeName(dataLayer.name)}_maxZoomStep`] = {
        type: "f",
        value: dataLayer.cube.MAX_ZOOM_STEP,
      };
    }

    for (const name of getColorLayerNames()) {
      this.uniforms[`${name}_alpha`] = {
        type: "f",
        value: 1,
      };
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

      this.uniforms[`${sanitizeName(name)}_textures`] = {
        type: "tv",
        value: dataTextures,
      };

      this.uniforms[`${sanitizeName(name)}_data_texture_width`] = {
        type: "f",
        value: dataLayer.layerRenderingManager.textureWidth,
      };

      this.uniforms[`${sanitizeName(name)}_lookup_texture`] = {
        type: "t",
        value: lookUpTexture,
      };
    }

    // Add mapping
    const segmentationLayer = Model.getSegmentationLayer();
    if (segmentationLayer != null && Model.isMappingSupported) {
      const [
        mappingTexture,
        mappingLookupTexture,
        mappingColorTexture,
      ] = segmentationLayer.mappings.getMappingTextures();
      this.uniforms[`${sanitizeName(segmentationLayer.name)}_mapping_texture`] = {
        type: "t",
        value: mappingTexture,
      };
      this.uniforms[`${sanitizeName(segmentationLayer.name)}_mapping_lookup_texture`] = {
        type: "t",
        value: mappingLookupTexture,
      };
      this.uniforms[`${sanitizeName(segmentationLayer.name)}_mapping_color_texture`] = {
        type: "t",
        value: mappingColorTexture,
      };
    }
  }

  makeMaterial(options?: ShaderMaterialOptions): void {
    this.material = new THREE.ShaderMaterial(
      _.extend(options, {
        uniforms: this.uniforms,
        vertexShader: this.getVertexShader(),
        fragmentShader: this.getFragmentShader(),
      }),
    );

    shaderEditor.addMaterial(this.shaderId, this.material);

    this.material.setGlobalPosition = ([x, y, z]) => {
      this.uniforms.globalPosition.value.set(x, y, z);
    };

    this.material.setAnchorPoint = ([x, y, z]) => {
      this.uniforms.anchorPoint.value.set(x, y, z);
    };

    this.material.setSegmentationAlpha = alpha => {
      this.uniforms.alpha.value = alpha / 100;
    };

    this.material.setSegmentationVisibility = isVisible => {
      this.uniforms.alpha.value = isVisible
        ? Store.getState().datasetConfiguration.segmentationOpacity / 100
        : 0;
    };

    this.material.setUseBilinearFiltering = isEnabled => {
      this.uniforms.useBilinearFiltering.value = isEnabled;
    };

    this.material.setIsMappingEnabled = isMappingEnabled => {
      this.uniforms.isMappingEnabled.value = isMappingEnabled;
    };

    this.material.side = THREE.DoubleSide;

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => getRequestLogZoomStep(storeState),
        zoomStep => {
          this.uniforms.zoomStep.value = zoomStep;
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => storeState.userConfiguration.sphericalCapRadius,
        sphericalCapRadius => {
          this.uniforms.sphericalCapRadius.value = sphericalCapRadius;
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => getZoomValue(storeState.flycam),
        zoomValue => {
          this.uniforms.zoomValue.value = zoomValue;
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => storeState.temporaryConfiguration.activeMapping.mappingSize,
        mappingSize => {
          this.uniforms.mappingSize.value = mappingSize;
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => storeState.temporaryConfiguration.activeMapping.hideUnmappedIds,
        hideUnmappedIds => {
          this.uniforms.hideUnmappedIds.value = hideUnmappedIds;
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => storeState.temporaryConfiguration.viewMode,
        viewMode => {
          this.uniforms.viewMode.value = ViewModeValues.indexOf(viewMode);
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => storeState.viewModeData.plane.activeViewport === this.planeID,
        isMouseInActiveViewport => {
          this.uniforms.isMouseInActiveViewport.value = isMouseInActiveViewport;
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => storeState.datasetConfiguration.highlightHoveredCellId,
        highlightHoveredCellId => {
          this.uniforms.highlightHoveredCellId.value = highlightHoveredCellId;
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => storeState.dataset,
        dataset => {
          const { lowerBoundary, upperBoundary } = getBoundaries(dataset);
          this.uniforms.bboxMin.value.set(...lowerBoundary);
          this.uniforms.bboxMax.value.set(...upperBoundary);
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        state => state.datasetConfiguration.layers,
        layerSettings => {
          for (const colorLayer of getColorLayers(Store.getState().dataset)) {
            const settings = layerSettings[colorLayer.name];
            if (settings != null) {
              const name = sanitizeName(colorLayer.name);
              this.updateUniformsForLayer(settings, name, colorLayer.elementClass);
            }
          }
          // TODO: Needed?
          app.vent.trigger("rerender");
        },
        true,
      ),
    );

    const hasSegmentation = Model.getSegmentationLayer() != null;
    if (hasSegmentation) {
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          storeState => storeState.temporaryConfiguration.mousePosition,
          globalMousePosition => {
            if (!globalMousePosition) {
              this.uniforms.isMouseInCanvas.value = false;
              return;
            }
            if (Store.getState().viewModeData.plane.activeViewport === OrthoViews.TDView) {
              return;
            }

            const [x, y, z] = calculateGlobalPos({
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
          storeState => storeState.userConfiguration.brushSize,
          brushSize => {
            this.uniforms.brushSizeInPixel.value = brushSize;
          },
          true,
        ),
      );

      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          storeState => storeState.temporaryConfiguration.hoveredIsosurfaceId,
          hoveredIsosurfaceId => {
            const [a, b, g, r] = Utils.convertDecToBase256(hoveredIsosurfaceId);
            this.uniforms.hoveredIsosurfaceId.value.set(r, g, b, a);
          },
        ),
      );

      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          storeState => Utils.maybe(getActiveCellId)(storeState.tracing.volume).getOrElse(0),
          () => this.updateActiveCellId(),
          true,
        ),
      );

      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          storeState => storeState.temporaryConfiguration.activeMapping.isMappingEnabled,
          () => this.updateActiveCellId(),
        ),
      );

      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          storeState => storeState.temporaryConfiguration.activeMapping.mapping,
          () => this.updateActiveCellId(),
        ),
      );

      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          storeState =>
            volumeToolEnumToIndex(
              Utils.toNullable(Utils.maybe(getVolumeTool)(storeState.tracing.volume)),
            ),
          volumeTool => {
            this.uniforms.activeVolumeToolIndex.value = volumeTool;
          },
          true,
        ),
      );
    }
  }

  updateActiveCellId() {
    const activeCellId = Utils.maybe(getActiveCellId)(Store.getState().tracing.volume).getOrElse(0);
    const mappedActiveCellId = Model.getSegmentationLayer().cube.mapId(activeCellId);
    // Convert the id into 4 bytes (little endian)
    const [a, b, g, r] = Utils.convertDecToBase256(mappedActiveCellId);
    this.uniforms.activeCellId.value.set(r, g, b, a);
  }

  updateUniformsForLayer(
    settings: DatasetLayerConfiguration,
    name: string,
    elementClass: ElementClass,
  ): void {
    const { alpha, intensityRange, isDisabled } = settings;
    // In UnsignedByte textures the byte values are scaled to [0, 1], in Float textures they are not
    const divisor = elementClass === "float" ? 1 : 255;
    this.uniforms[`${name}_min`].value = intensityRange[0] / divisor;
    this.uniforms[`${name}_max`].value = intensityRange[1] / divisor;
    this.uniforms[`${name}_alpha`].value = isDisabled ? 0 : alpha / 100;

    if (settings.color != null) {
      const color = this.convertColor(settings.color);
      this.uniforms[`${name}_color`].value = new THREE.Vector3(...color);
    }
  }

  getMaterial(): THREE.ShaderMaterial {
    return this.material;
  }

  getFragmentShader(): string {
    const colorLayerNames = getColorLayerNames();
    const packingDegreeLookup = getPackingDegreeLookup();
    const segmentationLayer = Model.getSegmentationLayer();
    const segmentationName = sanitizeName(segmentationLayer ? segmentationLayer.name : "");
    const { dataset } = Store.getState();
    const datasetScale = dataset.dataSource.scale;
    // Don't compile code for segmentation in arbitrary mode
    const hasSegmentation = this.isOrthogonal && segmentationLayer != null;

    const lookupTextureWidth = getLookupBufferSize(
      Store.getState().temporaryConfiguration.gpuSetup.initializedGpuFactor,
    );

    const code = getMainFragmentShader({
      colorLayerNames,
      packingDegreeLookup,
      hasSegmentation,
      segmentationName,
      isMappingSupported: Model.isMappingSupported,
      // Todo: this is not computed per layer. See #4018
      dataTextureCountPerLayer: Model.maximumDataTextureCountForLayer,
      resolutions: getResolutions(dataset),
      datasetScale,
      isOrthogonal: this.isOrthogonal,
      lookupTextureWidth,
    });

    return code;
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
