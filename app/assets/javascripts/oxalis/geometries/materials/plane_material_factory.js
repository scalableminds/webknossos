/**
 * plane_material_factory.js
 * @flow
 */

import * as THREE from "three";
import _ from "lodash";

import {
  ModeValues,
  type OrthoView,
  OrthoViewValues,
  OrthoViews,
  type Vector3,
  volumeToolEnumToIndex,
} from "oxalis/constants";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getActiveCellId, getVolumeTool } from "oxalis/model/accessors/volumetracing_accessor";
import {
  getColorLayers,
  getResolutions,
  isRgb,
  getByteCount,
  getBoundaries,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getMaxBucketCountPerDim,
  getPlaneScalingFactor,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import { getPackingDegree } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { getViewportScale } from "oxalis/model/accessors/view_mode_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import AbstractPlaneMaterialFactory, {
  type ShaderMaterialOptions,
  sanitizeName,
} from "oxalis/geometries/materials/abstract_plane_material_factory";
import Model from "oxalis/model";
import Store, { type DatasetLayerConfiguration } from "oxalis/store";
import * as Utils from "libs/utils";
import getMainFragmentShader from "oxalis/shaders/main_data_fragment.glsl";

const DEFAULT_COLOR = new THREE.Vector3([255, 255, 255]);

function getColorLayerNames() {
  return getColorLayers(Store.getState().dataset).map(layer => sanitizeName(layer.name));
}

class PlaneMaterialFactory extends AbstractPlaneMaterialFactory {
  planeID: OrthoView;
  isOrthogonal: boolean;

  constructor(planeID: OrthoView, isOrthogonal: boolean, shaderId: number) {
    super(shaderId);
    this.planeID = planeID;
    this.isOrthogonal = isOrthogonal;
  }

  stopListening() {
    this.storePropertyUnsubscribers.forEach(fn => fn());
  }

  setupUniforms(): void {
    super.setupUniforms();

    this.uniforms = _.extend(this.uniforms, {
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
      fallbackAnchorPoint: {
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
      pixelToVoxelFactor: {
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
      bucketsPerDim: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
    });

    for (const dataLayer of Model.getAllLayers()) {
      this.uniforms[sanitizeName(`${dataLayer.name}_maxZoomStep`)] = {
        type: "f",
        value: dataLayer.cube.MAX_ZOOM_STEP,
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

      this.uniforms[sanitizeName(`${name}_lookup_texture`)] = {
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
      this.uniforms[sanitizeName(`${segmentationLayer.name}_mapping_texture`)] = {
        type: "t",
        value: mappingTexture,
      };
      this.uniforms[sanitizeName(`${segmentationLayer.name}_mapping_lookup_texture`)] = {
        type: "t",
        value: mappingLookupTexture,
      };
      this.uniforms[sanitizeName(`${segmentationLayer.name}_mapping_color_texture`)] = {
        type: "t",
        value: mappingColorTexture,
      };
    }

    // Add weight/color uniforms
    for (const name of getColorLayerNames()) {
      this.uniforms[`${name}_weight`] = {
        type: "f",
        value: 1,
      };
      this.uniforms[`${name}_color`] = {
        type: "v3",
        value: DEFAULT_COLOR,
      };
    }
  }

  makeMaterial(options?: ShaderMaterialOptions): void {
    super.makeMaterial(options);

    this.material.setGlobalPosition = ([x, y, z]) => {
      this.uniforms.globalPosition.value.set(x, y, z);
    };

    this.material.setAnchorPoint = ([x, y, z]) => {
      this.uniforms.anchorPoint.value.set(x, y, z);
    };

    this.material.setFallbackAnchorPoint = ([x, y, z]) => {
      this.uniforms.fallbackAnchorPoint.value.set(x, y, z);
    };

    this.material.setSegmentationAlpha = alpha => {
      this.uniforms.alpha.value = alpha / 100;
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
        storeState => getRequestLogZoomStep(storeState),
        zoomStep => {
          const storeState = Store.getState();
          const { dataset } = storeState;
          const resolutions = getResolutions(dataset);
          const bucketsPerDim = getMaxBucketCountPerDim(
            dataset.dataSource.scale,
            zoomStep,
            resolutions,
          );

          this.uniforms.bucketsPerDim.value.set(...bucketsPerDim);
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
        storeState => storeState.flycam.zoomStep,
        zoomStep => {
          this.uniforms.zoomValue.value = zoomStep;
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
          this.uniforms.viewMode.value = ModeValues.indexOf(viewMode);
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        storeState => getPlaneScalingFactor(storeState.flycam) / getViewportScale(this.planeID),
        pixelToVoxelFactor => {
          this.uniforms.pixelToVoxelFactor.value = pixelToVoxelFactor;
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
          storeState => storeState.temporaryConfiguration.brushSize,
          brushSize => {
            this.uniforms.brushSizeInPixel.value = brushSize;
          },
          true,
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

  updateUniformsForLayer(settings: DatasetLayerConfiguration, name: string): void {
    super.updateUniformsForLayer(settings, name);

    if (settings.color != null) {
      const color = this.convertColor(settings.color);
      this.uniforms[`${name}_color`].value = new THREE.Vector3(...color);
    }
  }

  getFragmentShader(): string {
    const colorLayerNames = getColorLayerNames();
    const segmentationLayer = Model.getSegmentationLayer();
    const segmentationName = sanitizeName(segmentationLayer ? segmentationLayer.name : "");
    const { dataset } = Store.getState();
    const datasetScale = dataset.dataSource.scale;
    // Don't compile code for segmentation in arbitrary mode
    const hasSegmentation = this.isOrthogonal && segmentationLayer != null;

    const segmentationPackingDegree = hasSegmentation
      ? getPackingDegree(getByteCount(dataset, segmentationLayer.name))
      : 0;

    const code = getMainFragmentShader({
      colorLayerNames,
      hasSegmentation,
      segmentationName,
      segmentationPackingDegree,
      isRgb: Model.dataLayers.color && isRgb(dataset, Model.dataLayers.color.name),
      isMappingSupported: Model.isMappingSupported,
      dataTextureCountPerLayer: Model.maximumDataTextureCountForLayer,
      resolutions: getResolutions(dataset),
      datasetScale,
      isOrthogonal: this.isOrthogonal,
    });

    return code;
  }
}

export default PlaneMaterialFactory;
