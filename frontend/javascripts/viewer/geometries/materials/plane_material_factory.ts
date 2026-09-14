import app from "app";
import { CuckooTableVec3 } from "libs/cuckoo/cuckoo_table_vec3";
import { type Matrix4x4, V3 } from "libs/mjs";
import type TPS3D from "libs/thin_plate_spline";
import {
  computeBoundingBoxFromBoundingBoxObject,
  convertNumberTo64BitTuple,
  isWindows,
  map3,
} from "libs/utils";
import extend from "lodash-es/extend";
import flattenDeep from "lodash-es/flattenDeep";
import isEqual from "lodash-es/isEqual";
import keyBy from "lodash-es/keyBy";
import mapValues from "lodash-es/mapValues";
import partition from "lodash-es/partition";
import throttle from "lodash-es/throttle";
import { DoubleSide, Euler, Matrix4, ShaderMaterial, Vector3 as ThreeVector3 } from "three";
import type { ElementClass } from "types/api_types";
import type { ValueOf } from "types/type_utils";
import { WkDevFlags } from "viewer/api/wk_dev";
import {
  BLEND_MODES,
  Identity4x4,
  MappingStatusEnum,
  type OrthoView,
  OrthoViews,
  OrthoViewValues,
  type Vector3,
  ViewModeValues,
} from "viewer/constants";
import {
  getColorLayers,
  getDataLayers,
  getElementClass,
  getEnabledLayers,
  getLayerByName,
  getMagInfo,
  getMagInfoByLayer,
  getMappingInfoForSupportedLayer,
  getSegmentationLayerWithMappingSupport,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getTransformsForLayer,
  getTransformsPerLayer,
  invertAndTranspose,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  getActiveMagIndicesForLayers,
  getPosition,
  getRotationInRadian,
  getUnrenderableLayerInfosForCurrentZoom,
  getZoomValue,
  isRotated,
} from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool, isBrushTool } from "viewer/model/accessors/tool_accessor";
import { calculateGlobalPos, getViewportExtents } from "viewer/model/accessors/view_mode_accessor";
import {
  getActiveCellId,
  getActiveSegmentationTracing,
  getActiveUnmappedSegmentId,
  getBucketRetrievalSourceFn,
  getHideUnregisteredSegmentsForLayer,
  getProofreadingMarkerPosition,
  isZoomThresholdExceededForAgglomerateMapping,
  needsLocalHdf5Mapping,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  DTYPE_TAG_INT32,
  DTYPE_TAG_UINT32,
  getDtypeConfigForElementClass,
  getDtypeTagForElementClass,
} from "viewer/model/bucket_data_handling/data_rendering_logic";
import { getGlobalLayerIndexForLayerName } from "viewer/model/bucket_data_handling/layer_rendering_manager";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import shaderEditor from "viewer/model/helpers/shader_editor";
import getMainFragmentShader, {
  getMainVertexShader,
  type Params,
} from "viewer/shaders/main_data_shaders.glsl";
import { Model } from "viewer/singletons";
import type { DatasetLayerConfiguration } from "viewer/store";
import Store from "viewer/store";

type ShaderMaterialOptions = {
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
};
export type PlaneShaderMaterial = ShaderMaterial & {
  setPositionOffset: (x: number, y: number, z: number) => void;
  updateUseInterpolation: () => void;
};
const RECOMPILATION_THROTTLE_TIME = 500;
export type Uniforms = Record<
  string,
  {
    value: any;
  }
>;

const DEFAULT_COLOR = new ThreeVector3(255, 255, 255);

// Fixed, compile-time upper bound (see Params.maxActiveColorLayers in
// main_data_shaders.glsl.ts) for how many color layers can be simultaneously
// blended, independent of how many color layers the dataset actually has.
const MAX_ACTIVE_COLOR_LAYERS = 8;

const float32BitPunBuffer = new ArrayBuffer(4);
const float32BitPunAsFloat = new Float32Array(float32BitPunBuffer);
const float32BitPunAsInt = new Int32Array(float32BitPunBuffer);
const float32BitPunAsUint = new Uint32Array(float32BitPunBuffer);

// layerMin/layerMax are plain float uniform arrays (see SHARED_UNIFORM_DECLARATIONS
// in main_data_shaders.glsl.ts), but int32/uint32 layers need their exact integer
// min/max preserved without float's 24-bit exact-integer precision loss. We bit-pun
// the integer value into the float uniform's bit pattern here; the shader reverses
// this via floatBitsToInt/floatBitsToUint for those dtypes only.
// three.js's array-uniform uploader (flatten() in WebGLUniforms) requires
// every element of a mat4[]/vec3[] uniform array to be an object with
// .toArray() (or the whole array to already be fully-flattened primitives) --
// plain number tuples like Matrix4x4/Vector3 crash it. Scalar (non-array)
// mat4/vec3 uniforms don't have this restriction, which is why this wasn't
// an issue for the old per-layer-named uniforms.
function toThreeMatrix4(matrix: Matrix4x4): Matrix4 {
  return new Matrix4().fromArray(matrix);
}

function reinterpretIntAsFloatBits(value: number, elementClass: ElementClass): number {
  const dtypeTag = getDtypeTagForElementClass(elementClass);
  if (dtypeTag === DTYPE_TAG_INT32) {
    float32BitPunAsInt[0] = value;
    return float32BitPunAsFloat[0];
  }
  if (dtypeTag === DTYPE_TAG_UINT32) {
    float32BitPunAsUint[0] = value;
    return float32BitPunAsFloat[0];
  }
  return value;
}

function sanitizeName(name: string | null | undefined): string {
  if (WkDevFlags.bucketDebugging.disableLayerNameSanitization) {
    return name || "unknown name";
  }
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

function getTextureLayerInfos(): Params["textureLayerInfos"] {
  const { dataset } = Store.getState();
  const layers = getDataLayers(dataset);

  // keyBy the sanitized layer name as the lookup will happen in the shader using the sanitized layer name
  const layersObject = keyBy(layers, (layer) => sanitizeName(layer.name));

  return mapValues(layersObject, (layer): ValueOf<Params["textureLayerInfos"]> => {
    const elementClass = getElementClass(dataset, layer.name);
    const dtypeConfig = getDtypeConfigForElementClass(elementClass);
    return {
      packingDegree: dtypeConfig.packingDegree,
      glslPrefix: dtypeConfig.glslPrefix,
      dataTextureCount: Model.getLayerRenderingManagerByName(layer.name).dataTextureCount,
      isSigned: dtypeConfig.isSigned,
      elementClass,
      isColor: layer.category === "color",
      unsanitizedName: layer.name,
    };
  });
}

class PlaneMaterialFactory {
  planeID: OrthoView;
  isOrthogonal: boolean;
  material: PlaneShaderMaterial | undefined | null;
  uniforms: Uniforms = {};
  attributes: Record<string, any> = {};
  shaderId: number;
  storePropertyUnsubscribers: Array<() => void> = [];
  leastRecentlyVisibleLayers: Array<{ name: string; isSegmentationLayer: boolean }>;
  oldFragmentShaderCode: string | null | undefined;
  oldVertexShaderCode: string | null | undefined;
  unsubscribeColorSeedsFn: (() => void) | null = null;
  unsubscribeMappingSeedsFn: (() => void) | null = null;

  scaledTpsInvPerLayer: Record<string, TPS3D> = {};

  // The currently *declared* (compiled-into-the-shader) layer names, in the
  // exact order the shader's layerAlpha/layerMin/.../colorRenderOrder arrays
  // are indexed by. Kept in sync with getLayersToRender()'s result every time
  // the shader is (re)computed; see refreshCompiledLayerNames.
  compiledColorLayerNames: Array<string> = [];
  compiledSegmentationLayerNames: Array<string> = [];

  constructor(planeID: OrthoView, isOrthogonal: boolean, shaderId: number) {
    this.planeID = planeID;
    this.isOrthogonal = isOrthogonal;
    this.shaderId = shaderId;
    this.leastRecentlyVisibleLayers = [];
  }

  setup() {
    this.refreshCompiledLayerNames();
    this.setupUniforms();
    this.makeMaterial();
    this.attachTextures();
    return this;
  }

  refreshCompiledLayerNames(): void {
    const { maximumLayerCountToRender } = Store.getState().temporaryConfiguration.gpuSetup;
    const [colorLayerNames, segmentationLayerNames] =
      this.getLayersToRender(maximumLayerCountToRender);
    this.compiledColorLayerNames = colorLayerNames;
    this.compiledSegmentationLayerNames = segmentationLayerNames;
  }

  // All layers currently declared in the shader, color layers first -- the
  // exact index space that layerAlpha/layerMin/layerTransform/... and
  // getRgbaAtXYIndex's per-layer dispatch are indexed by.
  getCompiledLayerNames(): Array<string> {
    return this.compiledColorLayerNames.concat(this.compiledSegmentationLayerNames);
  }

  getDataLayerForSanitizedName(layerName: string) {
    const dataLayer = Model.getAllLayers().find(
      (candidate) => sanitizeName(candidate.name) === layerName,
    );
    if (dataLayer == null) {
      throw new Error(`Could not find data layer for sanitized name ${layerName}.`);
    }
    return dataLayer;
  }

  stopListening() {
    this.storePropertyUnsubscribers.forEach((fn) => {
      fn();
    });
    this.storePropertyUnsubscribers = [];
  }

  setupUniforms(): void {
    this.uniforms = {
      sphericalCapRadius: {
        value: 140,
      },
      selectiveVisibilityInProofreading: {
        value: true,
      },
      hideUnregisteredSegments: {
        value: false,
      },
      is3DViewBeingRendered: {
        value: true,
      },
      // This offset represent the offset of the plane during rendering its viewport. The offset is needed to see the skeleton behind the plane
      // configured by the clippingDistance setting. It is necessary to calculate the position of the data that should be rendered by subtracting
      // the offset in the shader. Note, that the position offset should already be in world scale.
      positionOffset: {
        value: new ThreeVector3(0, 0, 0),
      },
      // Passed so that in case of no ortho rotation and not flight mode the exact w component
      // can be taken for layer coordinates as due to back and forth calculation of voxel size
      // this might result in numeric imprecision rendering the wrong slice.
      globalPosition: {
        value: new ThreeVector3(0, 0, 0),
      },
      zoomValue: {
        value: 1,
      },
      viewportExtent: {
        value: [0, 0],
      },
      shouldApplyMappingOnGPU: {
        value: false,
      },
      mappingIsPartial: {
        value: false,
      },
      hideUnmappedIds: {
        value: false,
      },
      globalMousePosition: {
        value: new ThreeVector3(0, 0, 0),
      },
      proofreadingMarkerPosition: {
        value: new ThreeVector3(-1, -1, -1),
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
      renderBucketIndices: {
        value: false,
      },

      // The hovered segment id is always stored as a 64-bit (8 byte)
      // value which is why it is spread over two uniforms,
      // named as `-High` and `-Low`.
      hoveredSegmentIdHigh: {
        value: 0,
      },
      hoveredSegmentIdLow: {
        value: 0,
      },
      hoveredUnmappedSegmentIdHigh: {
        value: 0,
      },
      hoveredUnmappedSegmentIdLow: {
        value: 0,
      },
      // The same is done for the active cell id.
      activeCellIdHigh: {
        value: 0,
      },
      activeCellIdLow: {
        value: 0,
      },
      isUnmappedSegmentHighlighted: {
        value: false,
      },
      blendMode: { value: 1.0 },
      isFlycamRotated: { value: false },
      doAllLayersHaveTransforms: { value: false },
      inverseFlycamRotationMatrix: { value: new Matrix4() },
    };

    const activeMagIndices = getActiveMagIndicesForLayers(Store.getState());
    this.uniforms.activeMagIndices = {
      value: Object.values(activeMagIndices),
    };
    const { nativelyRenderedLayerName } = Store.getState().datasetConfiguration;
    const dataset = Store.getState().dataset;

    // Per-layer rendering metadata, indexed by compiled index (position in
    // this.getCompiledLayerNames() == colorLayerNames.concat(segmentationLayerNames)
    // as declared in the shader). See SHARED_UNIFORM_DECLARATIONS in
    // main_data_shaders.glsl.ts for how these are consumed.
    const compiledLayerNames = this.getCompiledLayerNames();
    const layerAlpha: number[] = [];
    const layerGammaCorrectionValue: number[] = [];
    const layerUnrenderable: number[] = [];
    const layerTransform: Matrix4[] = [];
    const layerHasTransformInt: number[] = [];
    const layerBboxMin: ThreeVector3[] = [];
    const layerBboxMax: ThreeVector3[] = [];
    const layerDataTextureWidth: number[] = [];
    const layerColor: ThreeVector3[] = [];
    const layerMin: number[] = [];
    const layerMax: number[] = [];
    const layerIsInverted: number[] = [];

    for (const layerName of compiledLayerNames) {
      const dataLayer = this.getDataLayerForSanitizedName(layerName);
      layerAlpha.push(1);
      layerGammaCorrectionValue.push(1);
      // If `_unrenderable` is true, the layer cannot (and should not) be
      // rendered in the current mag.
      layerUnrenderable.push(0);

      const layer = getLayerByName(dataset, dataLayer.name);
      const affineMatrix = getTransformsForLayer(
        dataset,
        layer,
        nativelyRenderedLayerName,
      ).affineMatrix;
      layerTransform.push(toThreeMatrix4(invertAndTranspose(affineMatrix)));
      layerHasTransformInt.push(isEqual(affineMatrix, Identity4x4) ? 0 : 1);

      const bbox = computeBoundingBoxFromBoundingBoxObject(layer.boundingBox);
      layerBboxMin.push(new ThreeVector3(...bbox.min));
      layerBboxMax.push(new ThreeVector3(...bbox.max));
      layerDataTextureWidth.push(0);

      layerColor.push(DEFAULT_COLOR);
      layerMin.push(0.0);
      layerMax.push(1.0);
      layerIsInverted.push(0);
    }

    this.uniforms.layerAlpha = { value: layerAlpha };
    this.uniforms.layerGammaCorrectionValue = { value: layerGammaCorrectionValue };
    this.uniforms.layerUnrenderable = { value: layerUnrenderable };
    this.uniforms.layerTransform = { value: layerTransform };
    this.uniforms.layerHasTransformInt = { value: layerHasTransformInt };
    this.uniforms.layerBboxMin = { value: layerBboxMin };
    this.uniforms.layerBboxMax = { value: layerBboxMax };
    this.uniforms.layerDataTextureWidth = { value: layerDataTextureWidth };
    this.uniforms.layerColor = { value: layerColor };
    this.uniforms.layerMin = { value: layerMin };
    this.uniforms.layerMax = { value: layerMax };
    this.uniforms.layerIsInverted = { value: layerIsInverted };

    const { colorRenderOrder, activeColorLayerCount } = this.getColorRenderOrder();
    this.uniforms.colorRenderOrder = { value: colorRenderOrder };
    this.uniforms.activeColorLayerCount = { value: activeColorLayerCount };

    // getSegmentId_<name> in segmentation.glsl.ts is still generated per
    // layer name (deferred, see main_data_shaders.glsl.ts), so segmentation
    // layers keep their own named _transform/_has_transform/_bboxMin/_bboxMax/
    // _data_texture_width uniforms in addition to the arrays above.
    for (const layerName of this.compiledSegmentationLayerNames) {
      const dataLayer = this.getDataLayerForSanitizedName(layerName);
      const layer = getLayerByName(dataset, dataLayer.name);
      const affineMatrix = getTransformsForLayer(
        dataset,
        layer,
        nativelyRenderedLayerName,
      ).affineMatrix;
      const bbox = computeBoundingBoxFromBoundingBoxObject(layer.boundingBox);
      this.uniforms[`${layerName}_transform`] = { value: invertAndTranspose(affineMatrix) };
      this.uniforms[`${layerName}_has_transform`] = {
        value: !isEqual(affineMatrix, Identity4x4),
      };
      this.uniforms[`${layerName}_bboxMin`] = { value: bbox.min };
      this.uniforms[`${layerName}_bboxMax`] = { value: bbox.max };
      this.uniforms[`${layerName}_data_texture_width`] = { value: 0 };
    }
  }

  convertColor(color: Vector3): Vector3 {
    return [color[0] / 255, color[1] / 255, color[2] / 255];
  }

  attachTextures(): void {
    let sharedLookUpTexture;
    let sharedLookUpCuckooTable;
    // compiledIdx lookup for the layerDataTextureWidth[] array (only declared
    // layers have a slot there; see setupUniforms).
    const compiledIdxByName = new Map(
      this.getCompiledLayerNames().map((layerName, idx) => [layerName, idx]),
    );
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
      // Segmentation layers still have their own named _data_texture_width
      // uniform too (see setupUniforms); harmless to also set it here for
      // color layers even though it's unused by the shader.
      this.uniforms[`${layerName}_data_texture_width`] = {
        value: dataLayer.layerRenderingManager.textureWidth,
      };
      const compiledIdx = compiledIdxByName.get(layerName);
      if (compiledIdx != null) {
        this.uniforms.layerDataTextureWidth.value[compiledIdx] =
          dataLayer.layerRenderingManager.textureWidth;
      }
    }

    if (!sharedLookUpCuckooTable) {
      throw new Error("Empty layer list at unexpected point.");
    }

    this.uniforms.lookup_texture = {
      value: sharedLookUpTexture,
    };

    this.unsubscribeColorSeedsFn = sharedLookUpCuckooTable.subscribeToSeeds((seeds: number[]) => {
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
    const cuckoo =
      segmentationLayer?.mappings != null ? segmentationLayer.mappings.getCuckooTable() : null;

    // It's important to set up the uniforms, since later additions to
    // `this.uniforms` won't be properly attached otherwise.
    this.uniforms.segmentation_mapping_texture = {
      value: cuckoo?.getTexture() || CuckooTableVec3.getNullTexture(),
    };
    this.uniforms.mapping_seeds = { value: [0, 0, 0] };
    this.uniforms.is_mapping_64bit = {
      value: segmentationLayer?.mappings?.is64Bit() || false,
    };

    this.unsubscribeMappingSeedsFn?.();

    if (cuckoo) {
      this.unsubscribeMappingSeedsFn = cuckoo.subscribeToSeeds((seeds: number[]) => {
        this.uniforms.mapping_seeds = { value: seeds };
      });
      const {
        CUCKOO_ENTRY_CAPACITY,
        CUCKOO_ELEMENTS_PER_ENTRY,
        CUCKOO_ELEMENTS_PER_TEXEL,
        CUCKOO_TWIDTH,
      } = cuckoo.getUniformValues();
      this.uniforms.MAPPING_CUCKOO_ENTRY_CAPACITY = { value: CUCKOO_ENTRY_CAPACITY };
      this.uniforms.MAPPING_CUCKOO_ELEMENTS_PER_ENTRY = { value: CUCKOO_ELEMENTS_PER_ENTRY };
      this.uniforms.MAPPING_CUCKOO_ELEMENTS_PER_TEXEL = { value: CUCKOO_ELEMENTS_PER_TEXEL };
      this.uniforms.MAPPING_CUCKOO_TWIDTH = { value: CUCKOO_TWIDTH };
    } else {
      this.uniforms.MAPPING_CUCKOO_ENTRY_CAPACITY = { value: 0 };
      this.uniforms.MAPPING_CUCKOO_ELEMENTS_PER_ENTRY = { value: 0 };
      this.uniforms.MAPPING_CUCKOO_ELEMENTS_PER_TEXEL = { value: 0 };
      this.uniforms.MAPPING_CUCKOO_TWIDTH = { value: 0 };
    }
  }

  attachSegmentationColorTexture(): void {
    const segmentationLayer = Model.getVisibleSegmentationLayer();
    if (segmentationLayer == null) {
      this.uniforms.custom_color_seeds = { value: [0, 0, 0] };

      this.uniforms.COLOR_CUCKOO_ENTRY_CAPACITY = { value: 0 };
      this.uniforms.COLOR_CUCKOO_ELEMENTS_PER_ENTRY = { value: 0 };
      this.uniforms.COLOR_CUCKOO_ELEMENTS_PER_TEXEL = { value: 0 };
      this.uniforms.COLOR_CUCKOO_TWIDTH = { value: 0 };
      this.uniforms.custom_color_texture = { value: CuckooTableVec3.getNullTexture() };
      return;
    }
    const cuckoo = segmentationLayer.layerRenderingManager.getCustomColorCuckooTable();
    const customColorTexture = cuckoo.getTexture();

    if (this.unsubscribeColorSeedsFn != null) {
      this.unsubscribeColorSeedsFn();
    }
    this.unsubscribeColorSeedsFn = cuckoo.subscribeToSeeds((seeds: number[]) => {
      this.uniforms.custom_color_seeds = { value: seeds };
    });
    const {
      CUCKOO_ENTRY_CAPACITY,
      CUCKOO_ELEMENTS_PER_ENTRY,
      CUCKOO_ELEMENTS_PER_TEXEL,
      CUCKOO_TWIDTH,
    } = cuckoo.getUniformValues();
    this.uniforms.COLOR_CUCKOO_ENTRY_CAPACITY = { value: CUCKOO_ENTRY_CAPACITY };
    this.uniforms.COLOR_CUCKOO_ELEMENTS_PER_ENTRY = { value: CUCKOO_ELEMENTS_PER_ENTRY };
    this.uniforms.COLOR_CUCKOO_ELEMENTS_PER_TEXEL = { value: CUCKOO_ELEMENTS_PER_TEXEL };
    this.uniforms.COLOR_CUCKOO_TWIDTH = { value: CUCKOO_TWIDTH };
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
    this.material = new ShaderMaterial(
      extend(options, {
        uniforms: this.uniforms,
        vertexShader: this.getVertexShader(),
        fragmentShader,
      }),
    ) as PlaneShaderMaterial;

    shaderEditor.addMaterial(this.shaderId, this.material);

    this.material.setPositionOffset = (x, y, z) => {
      this.uniforms.positionOffset.value.set(x, y, z);
    };

    this.material.updateUseInterpolation = () => {
      this.recomputeShaders();
    };

    this.material.side = DoubleSide;
  }

  startListeningForUniforms() {
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (storeState) => getActiveMagIndicesForLayers(storeState),
        () => this.updateVertexAlignment(),
        true,
      ),
      listenToStoreProperty(
        (storeState) =>
          getTransformsPerLayer(
            storeState.dataset,
            storeState.datasetConfiguration.nativelyRenderedLayerName,
          ),
        () => this.updateVertexAlignment(),
      ),

      listenToStoreProperty(
        (storeState) => getViewportExtents(storeState),
        (extents) => {
          this.uniforms.viewportExtent.value = extents[this.planeID];
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) =>
          getUnrenderableLayerInfosForCurrentZoom(storeState).map(({ layer }) => layer),
        (unrenderableLayers) => {
          const unrenderableLayerNames = unrenderableLayers.map((l) => l.name);
          const compiledLayerNames = this.getCompiledLayerNames();

          compiledLayerNames.forEach((layerName, idx) => {
            const dataLayer = this.getDataLayerForSanitizedName(layerName);
            this.uniforms.layerUnrenderable.value[idx] = unrenderableLayerNames.includes(
              dataLayer.name,
            );
          });
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => storeState.userConfiguration.sphericalCapRadius,
        (sphericalCapRadius) => {
          this.uniforms.sphericalCapRadius.value = sphericalCapRadius;
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => storeState.userConfiguration.selectiveVisibilityInProofreading,
        (selectiveVisibilityInProofreading) => {
          this.uniforms.selectiveVisibilityInProofreading.value = selectiveVisibilityInProofreading;
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => getMagInfoByLayer(storeState.dataset),
        (magInfosByLayer) => {
          const allDenseMags = Object.values(magInfosByLayer).map((magInfo) =>
            magInfo.getDenseMags(),
          );
          const flatMags = flattenDeep(allDenseMags);
          this.uniforms.allMagnifications = {
            value: flatMags,
          };

          let cumSum = 0;
          const magCountCumSum = [cumSum];
          for (const denseMags of allDenseMags) {
            cumSum += denseMags.length;
            magCountCumSum.push(cumSum);
          }

          this.uniforms.magnificationCountCumSum = {
            value: magCountCumSum,
          };
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => getZoomValue(storeState.flycam),
        (zoomValue) => {
          this.uniforms.zoomValue.value = zoomValue;
        },
        true,
      ),

      listenToStoreProperty(
        (storeState) => getMappingInfoForSupportedLayer(storeState).hideUnmappedIds,
        (hideUnmappedIds) => {
          this.uniforms.hideUnmappedIds.value = hideUnmappedIds;
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => storeState.temporaryConfiguration.viewMode,
        (viewMode) => {
          this.uniforms.viewMode.value = ViewModeValues.indexOf(viewMode);
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => storeState.viewModeData.plane.activeViewport === this.planeID,
        (isMouseInActiveViewport) => {
          this.uniforms.isMouseInActiveViewport.value = isMouseInActiveViewport;
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => storeState.datasetConfiguration.blendMode,
        (blendMode) => {
          if (blendMode === BLEND_MODES.Cover) {
            this.uniforms.blendMode.value = 0.0;
          } else if (blendMode === BLEND_MODES.Additive) {
            this.uniforms.blendMode.value = 1.0;
          } else if (blendMode === BLEND_MODES.CoverWithBlackAsTransparent) {
            this.uniforms.blendMode.value = 2.0;
          } else {
            throw new Error(`Unsupported blend mode: ${blendMode}`);
          }
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => isRotated(storeState.flycam),
        (isRotated) => {
          this.uniforms.isFlycamRotated.value = isRotated;
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => getPosition(storeState.flycam),
        (flycamPos) => {
          this.uniforms.globalPosition.value = flycamPos;
        },
        true,
      ),
      listenToStoreProperty(
        (storeState) => getRotationInRadian(storeState.flycam),
        (rotation) => {
          const state = Store.getState();
          const position = getPosition(state.flycam);

          const toOrigin = new Matrix4().makeTranslation(...map3((p) => -p, position));
          const backToFlycamCenter = new Matrix4().makeTranslation(...position);
          const invertRotation = new Matrix4()
            .makeRotationFromEuler(new Euler(rotation[0], rotation[1], rotation[2], "ZYX"))
            .invert();
          const inverseFlycamRotationMatrix = toOrigin
            .multiply(invertRotation)
            .multiply(backToFlycamCenter);
          this.uniforms.inverseFlycamRotationMatrix.value = inverseFlycamRotationMatrix;
        },
      ),
    );
    const oldVisibilityPerLayer: Record<string, boolean> = {};
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.datasetConfiguration.layers,
        (layerSettings) => {
          let updatedLayerVisibility = false;
          const compiledIdxByName = new Map(
            this.getCompiledLayerNames().map((name, idx) => [name, idx]),
          );
          for (const dataLayer of Model.getAllLayers()) {
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
              const compiledIdx = compiledIdxByName.get(sanitizeName(dataLayer.name));
              if (compiledIdx != null) {
                this.updateUniformsForLayer(
                  settings,
                  compiledIdx,
                  dataLayer.name,
                  isSegmentationLayer,
                );
              }
            }
          }
          if (updatedLayerVisibility) {
            // The *declared* set of layers might have changed (only relevant
            // when there are more layers than fit on the GPU simultaneously);
            // recomputeShaders no-ops via string-equality otherwise.
            this.recomputeShaders();
          }
          // Toggling visibility never needs to change which layers are
          // declared in the shader (see above) -- just which (up to
          // MAX_ACTIVE_COLOR_LAYERS) of them are actively blended, which is a
          // pure uniform update.
          this.updateColorRenderOrderUniform();
          app.vent.emit("rerender");
        },
        true,
      ),
    );

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.datasetConfiguration.colorLayerOrder,
        () => {
          // Reordering color layers never changes which layers are declared
          // in the shader, only their blend order -- a pure uniform update,
          // no recompile needed.
          this.updateColorRenderOrderUniform();
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
            }).rounded;
            this.uniforms.globalMousePosition.value.set(x, y, z);
            this.uniforms.isMouseInCanvas.value = true;
          },
          true,
        ),
        listenToStoreProperty(
          (storeState) => getSegmentationLayerWithMappingSupport(storeState),
          (_segmentationLayer) => {
            this.attachSegmentationMappingTextures();
          },
        ),
        listenToStoreProperty(
          (storeState) => getVisibleSegmentationLayer(storeState),
          (_segmentationLayer) => {
            this.attachSegmentationColorTexture();
          },
        ),
        listenToStoreProperty(
          (storeState) => storeState.userConfiguration.brushSize,
          (brushSize) => {
            this.uniforms.brushSizeInPixel.value = brushSize;
          },
          true,
        ),

        listenToStoreProperty(
          (storeState) => storeState.datasetConfiguration.segmentationPatternOpacity,
          (segmentationPatternOpacity) => {
            this.uniforms.segmentationPatternOpacity.value = segmentationPatternOpacity;
          },
          true,
        ),
        listenToStoreProperty(
          (storeState) => storeState.temporaryConfiguration.hoveredSegmentId,
          (hoveredSegmentId) => {
            const [high, low] = convertNumberTo64BitTuple(hoveredSegmentId);

            this.uniforms.hoveredSegmentIdLow.value = low;
            this.uniforms.hoveredSegmentIdHigh.value = high;
          },
        ),
        listenToStoreProperty(
          (storeState) => storeState.temporaryConfiguration.hoveredUnmappedSegmentId,
          (hoveredUnmappedSegmentId) => {
            const [high, low] = convertNumberTo64BitTuple(hoveredUnmappedSegmentId);

            this.uniforms.hoveredUnmappedSegmentIdLow.value = low;
            this.uniforms.hoveredUnmappedSegmentIdHigh.value = high;
          },
        ),
        listenToStoreProperty(
          (storeState) => {
            const activeSegmentationTracing = getActiveSegmentationTracing(storeState);
            return activeSegmentationTracing ? getActiveCellId(activeSegmentationTracing) : 0n;
          },
          () => this.updateActiveCellId(),
          true,
        ),
      );

      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (storeState) => {
            const layer = getVisibleSegmentationLayer(storeState);
            return layer != null
              ? getHideUnregisteredSegmentsForLayer(storeState, layer.name)
              : false;
          },
          (value) => {
            this.uniforms.hideUnregisteredSegments.value = value;
          },
          true,
        ),
        listenToStoreProperty(
          (storeState) =>
            getActiveUnmappedSegmentId(storeState, getActiveSegmentationTracing(storeState)),
          (activeUnmappedSegmentId) =>
            (this.uniforms.isUnmappedSegmentHighlighted.value = activeUnmappedSegmentId != null),
          true,
        ),
        listenToStoreProperty(
          (storeState) =>
            getMappingInfoForSupportedLayer(storeState).mappingStatus === MappingStatusEnum.ENABLED,
          () => this.updateActiveCellId(),
        ),
        listenToStoreProperty(
          (storeState) => getMappingInfoForSupportedLayer(storeState).mapping,
          () => this.updateActiveCellId(),
        ),
        listenToStoreProperty(
          (storeState) => {
            const layer = getSegmentationLayerWithMappingSupport(storeState);
            if (!layer) {
              return false;
            }

            const isGPUMappingDisabled = isZoomThresholdExceededForAgglomerateMapping(
              storeState,
              layer.name,
            );

            return (
              getMappingInfoForSupportedLayer(storeState).mappingStatus ===
                MappingStatusEnum.ENABLED &&
              isEqual(getBucketRetrievalSourceFn(layer.name)(storeState).slice(0, 2), [
                "REQUESTED-WITHOUT-MAPPING",
                "LOCAL-MAPPING-APPLIED",
              ]) &&
              !isGPUMappingDisabled
            );
          },
          (shouldApplyMappingOnGPU) => {
            this.uniforms.shouldApplyMappingOnGPU.value = shouldApplyMappingOnGPU;
          },
        ),
        listenToStoreProperty(
          (storeState) => {
            const layer = getSegmentationLayerWithMappingSupport(storeState);
            if (!layer) {
              return false;
            }

            return needsLocalHdf5Mapping(storeState, layer.name);
          },
          (mappingIsPartial) => {
            this.uniforms.mappingIsPartial.value = mappingIsPartial;
          },
        ),

        listenToStoreProperty(
          (storeState) => storeState.uiInformation.activeTool,
          (annotationTool) => {
            this.uniforms.showBrush.value = isBrushTool(annotationTool);
            this.uniforms.isProofreading.value = annotationTool === AnnotationTool.PROOFREAD;
          },
          true,
        ),

        listenToStoreProperty(
          (storeState) => getProofreadingMarkerPosition(storeState),
          (proofreadingMarkerPosition) => {
            if (proofreadingMarkerPosition != null) {
              this.uniforms.proofreadingMarkerPosition.value.set(...proofreadingMarkerPosition);
            } else {
              this.uniforms.proofreadingMarkerPosition.value.set(-1, -1, -1);
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
          const compiledIdxByName = new Map(
            this.getCompiledLayerNames().map((name, idx) => [name, idx]),
          );
          const segmentationNameSet = new Set(this.compiledSegmentationLayerNames);
          let countOfLayersWithTransforms = 0;
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

            const hasTransform = !isEqual(affineMatrix, Identity4x4);
            if (hasTransform) {
              countOfLayersWithTransforms++;
            }

            const compiledIdx = compiledIdxByName.get(name);
            if (compiledIdx != null) {
              this.uniforms.layerTransform.value[compiledIdx] = toThreeMatrix4(
                invertAndTranspose(affineMatrix),
              );
              this.uniforms.layerHasTransformInt.value[compiledIdx] = hasTransform ? 1 : 0;
            }
            // Segmentation layers additionally keep their own named uniform
            // (see setupUniforms) since getSegmentId_<name> is still
            // generated per layer name.
            if (segmentationNameSet.has(name)) {
              this.uniforms[`${name}_transform`].value = invertAndTranspose(affineMatrix);
              this.uniforms[`${name}_has_transform`] = { value: hasTransform };
            }
          }
          this.uniforms.doAllLayersHaveTransforms = {
            value: countOfLayersWithTransforms === layers.length,
          };
          // Presence of a TPS transform is still baked into the shader text
          // (layerHasTpsTransform / tpsOffsetXYZ_<name>, see
          // main_data_shaders.glsl.ts), so this still needs a recompile --
          // recomputeShaders() no-ops via string-equality if the generated
          // source didn't actually change (e.g. only the affine matrix
          // values changed, not which layers have a transform at all).
          this.recomputeShaders();
        },
        true,
      ),
    );
  }

  updateVertexAlignment(): void {
    const storeState = Store.getState();
    const activeMagIndices = getActiveMagIndicesForLayers(storeState);
    const { nativelyRenderedLayerName } = storeState.datasetConfiguration;

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

    let representativeMagForVertexAlignment: Vector3 = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ];
    const state = Store.getState();
    for (const [layerName, activeMagIndex] of Object.entries(activeMagIndices)) {
      const layer = getLayerByName(state.dataset, layerName);
      const magInfo = getMagInfo(layer.mags);
      // If the active mag doesn't exist, a fallback mag is likely rendered. Use that
      // to determine a representative mag.
      const suitableMagIndex = magInfo.getIndexOrClosestHigherIndex(activeMagIndex);
      const suitableMag = suitableMagIndex != null ? magInfo.getMagByIndex(suitableMagIndex) : null;

      const hasTransform = !isEqual(
        getTransformsForLayer(state.dataset, layer, nativelyRenderedLayerName).affineMatrix,
        Identity4x4,
      );
      if (!hasTransform && suitableMag) {
        representativeMagForVertexAlignment = V3.min(
          representativeMagForVertexAlignment,
          suitableMag,
        );
      }
    }

    if (Math.max(...representativeMagForVertexAlignment) === Number.POSITIVE_INFINITY) {
      representativeMagForVertexAlignment = [1, 1, 1];
    }
    this.uniforms.representativeMagForVertexAlignment = {
      value: representativeMagForVertexAlignment,
    };
  }

  updateActiveCellId() {
    const activeSegmentationTracing = getActiveSegmentationTracing(Store.getState());
    const activeCellId = activeSegmentationTracing
      ? getActiveCellId(activeSegmentationTracing)
      : 0n;

    if (activeSegmentationTracing == null) {
      return;
    }

    const [high, low] = convertNumberTo64BitTuple(activeCellId);

    this.uniforms.activeCellIdLow.value = low;
    this.uniforms.activeCellIdHigh.value = high;
  }

  updateUniformsForLayer(
    settings: DatasetLayerConfiguration,
    compiledIdx: number,
    rawLayerName: string,
    isSegmentationLayer: boolean,
  ): void {
    const { alpha, intensityRange, isDisabled, isInverted, gammaCorrectionValue } = settings;

    if (!isSegmentationLayer) {
      if (intensityRange) {
        const elementClass = getElementClass(Store.getState().dataset, rawLayerName);
        this.uniforms.layerMin.value[compiledIdx] = reinterpretIntAsFloatBits(
          intensityRange[0],
          elementClass,
        );
        this.uniforms.layerMax.value[compiledIdx] = reinterpretIntAsFloatBits(
          intensityRange[1],
          elementClass,
        );
      }
      this.uniforms.layerIsInverted.value[compiledIdx] = isInverted ? 1.0 : 0;

      if (settings.color != null) {
        const color = this.convertColor(settings.color);
        this.uniforms.layerColor.value[compiledIdx] = new ThreeVector3(...color);
      }
    }

    this.uniforms.layerAlpha.value[compiledIdx] = isDisabled ? 0 : alpha / 100;
    this.uniforms.layerGammaCorrectionValue.value[compiledIdx] = gammaCorrectionValue;
  }

  getMaterial(): PlaneShaderMaterial {
    if (this.material == null) {
      throw new Error("Tried to access material, but it is null.");
    }
    return this.material;
  }

  recomputeShaders = throttle(() => {
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

  getLayersToRender(maximumLayerCountToRender: number): [Array<string>, Array<string>, number] {
    // This function determines for which layers
    // the shader code should be compiled/declared. If the GPU supports
    // all layers, we can simply declare all layers here -- which (up to
    // maxActiveColorLayers) of them are actually blended each frame is a
    // separate, purely uniform-driven concern (see getColorRenderOrder).
    // Otherwise, we prioritize layers to declare by taking
    // into account (a) which layers are activated and (b) which
    // layers were least-recently activated (but are now disabled).
    // The first array contains the color layer names and the second the segmentation layer names.
    // The third parameter returns the number of globally available layers (this is not always equal
    // to the sum of the lengths of the first two arrays, as not all layers might be declared.)
    const state = Store.getState();
    const colorLayerNames = getSanitizedColorLayerNames();
    const segmentationLayerNames = Model.getSegmentationLayers().map((layer) =>
      sanitizeName(layer.name),
    );
    const globalLayerCount = colorLayerNames.length + segmentationLayerNames.length;
    if (maximumLayerCountToRender <= 0) {
      return [[], [], globalLayerCount];
    }

    if (maximumLayerCountToRender >= globalLayerCount) {
      // We can simply declare all available layers.
      return [colorLayerNames, segmentationLayerNames, globalLayerCount];
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

    const [sanitizedColorLayerNames, sanitizedSegmentationLayerNames] = partition(
      names,
      ({ isSegmentationLayer }) => !isSegmentationLayer,
    ).map((layers) => layers.map(({ name }) => sanitizeName(name)));

    return [sanitizedColorLayerNames, sanitizedSegmentationLayerNames, globalLayerCount];
  }

  // Computes, from the currently *declared* color layers (this.compiledColorLayerNames),
  // which (up to MAX_ACTIVE_COLOR_LAYERS) are enabled and in what order they should be
  // blended, based on the user's configured colorLayerOrder. This is entirely separate
  // from getLayersToRender/recomputeShaders: toggling visibility or reordering layers
  // only ever changes the result of this function, which is written directly into the
  // colorRenderOrder/activeColorLayerCount uniforms -- never requiring a shader recompile
  // (unless the declared set itself also happens to change, e.g. in the GPU-constrained
  // case; see the datasetConfiguration.layers listener in startListeningForUniforms).
  getColorRenderOrder(): { colorRenderOrder: number[]; activeColorLayerCount: number } {
    const state = Store.getState();
    const { colorLayerOrder, layers } = state.datasetConfiguration;
    const compiledIndexByName = new Map(
      this.compiledColorLayerNames.map((name, idx) => [name, idx]),
    );

    const activeIndices: number[] = [];
    for (const rawName of colorLayerOrder) {
      if (activeIndices.length >= MAX_ACTIVE_COLOR_LAYERS) {
        break;
      }
      const settings = layers[rawName];
      if (settings == null || settings.isDisabled) {
        continue;
      }
      const idx = compiledIndexByName.get(sanitizeName(rawName));
      if (idx != null) {
        activeIndices.push(idx);
      }
    }

    const colorRenderOrder = new Array(MAX_ACTIVE_COLOR_LAYERS).fill(0);
    activeIndices.forEach((idx, i) => {
      colorRenderOrder[i] = idx;
    });
    return { colorRenderOrder, activeColorLayerCount: activeIndices.length };
  }

  updateColorRenderOrderUniform(): void {
    const { colorRenderOrder, activeColorLayerCount } = this.getColorRenderOrder();
    this.uniforms.colorRenderOrder.value = colorRenderOrder;
    this.uniforms.activeColorLayerCount.value = activeColorLayerCount;
    app.vent.emit("rerender");
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
    const state = Store.getState();
    this.refreshCompiledLayerNames();
    const colorLayerNames = this.compiledColorLayerNames;
    const segmentationLayerNames = this.compiledSegmentationLayerNames;
    const globalLayerCount = colorLayerNames.length + segmentationLayerNames.length;

    const availableLayerNames = this.getCompiledLayerNames();

    const availableLayerIndexToGlobalLayerIndex = availableLayerNames.map((layerName) =>
      getGlobalLayerIndexForLayerName(layerName, sanitizeName),
    );

    const textureLayerInfos = getTextureLayerInfos();
    const { dataset } = state;
    const voxelSizeFactor = dataset.dataSource.scale.factor;
    const voxelSizeFactorInverted = V3.divide3([1, 1, 1], voxelSizeFactor);
    const { interpolation } = state.datasetConfiguration;
    const code = getMainFragmentShader({
      globalLayerCount,
      colorLayerNames,
      segmentationLayerNames,
      textureLayerInfos,
      magnificationsCount: this.getTotalMagCount(),
      voxelSizeFactor,
      voxelSizeFactorInverted,
      isOrthogonal: this.isOrthogonal,
      useInterpolation: interpolation,
      tpsTransformPerLayer: this.scaledTpsInvPerLayer,
      isWindows: isWindows(),
      maxActiveColorLayers: MAX_ACTIVE_COLOR_LAYERS,
    });
    return [
      code,
      { availableLayerIndexToGlobalLayerIndex: { value: availableLayerIndexToGlobalLayerIndex } },
    ];
  }

  getTotalMagCount(): number {
    const storeState = Store.getState();
    const allDenseMags = Object.values(getMagInfoByLayer(storeState.dataset)).map((magInfo) =>
      magInfo.getDenseMags(),
    );
    const flatMags = allDenseMags.flat();
    return flatMags.length;
  }

  getVertexShader(): string {
    const state = Store.getState();
    this.refreshCompiledLayerNames();
    const colorLayerNames = this.compiledColorLayerNames;
    const segmentationLayerNames = this.compiledSegmentationLayerNames;
    const globalLayerCount = colorLayerNames.length + segmentationLayerNames.length;

    const textureLayerInfos = getTextureLayerInfos();
    const { dataset } = state;
    const voxelSizeFactor = dataset.dataSource.scale.factor;
    const voxelSizeFactorInverted = V3.divide3([1, 1, 1], voxelSizeFactor);
    const { interpolation } = state.datasetConfiguration;

    return getMainVertexShader({
      globalLayerCount,
      colorLayerNames,
      segmentationLayerNames,
      textureLayerInfos,
      magnificationsCount: this.getTotalMagCount(),
      voxelSizeFactor,
      voxelSizeFactorInverted,
      isOrthogonal: this.isOrthogonal,
      useInterpolation: interpolation,
      tpsTransformPerLayer: this.scaledTpsInvPerLayer,
      isWindows: isWindows(),
      maxActiveColorLayers: MAX_ACTIVE_COLOR_LAYERS,
    });
  }

  destroy() {
    this.stopListening();
    if (this.unsubscribeColorSeedsFn) {
      this.unsubscribeColorSeedsFn();
      this.unsubscribeColorSeedsFn = null;
    }
    if (this.unsubscribeMappingSeedsFn) {
      this.unsubscribeMappingSeedsFn();
      this.unsubscribeMappingSeedsFn = null;
    }
    // Dispose the material so that the compiled shader program can be
    // released from three.js' program cache.
    this.material?.dispose();
    this.material = null;
    this.recomputeShaders.cancel();

    // Avoid memory leaks on tear down.
    for (const key of Object.keys(this.uniforms)) {
      this.uniforms[key].value = null;
    }
  }
}

export default PlaneMaterialFactory;
