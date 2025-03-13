import ErrorHandling from "libs/error_handling";
import { formatExtentInUnitWithLength, formatNumberToLength } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { aggregateBoundingBox, maxValue } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import messages from "messages";
import { LongUnitToShortUnitMap, type Vector3, type ViewMode } from "oxalis/constants";
import constants, { ViewModeValues, Vector3Indicies, MappingStatusEnum } from "oxalis/constants";
import type {
  ActiveMappingInfo,
  BoundingBoxObject,
  DataLayerType,
  DatasetConfiguration,
  OxalisState,
  Settings,
} from "oxalis/store";
import type {
  APIAllowedMode,
  APIDataLayer,
  APIDataset,
  APIDatasetCompact,
  APIMaybeUnimportedDataset,
  APISegmentationLayer,
  AdditionalAxis,
  ElementClass,
} from "types/api_flow_types";
import type { DataLayer } from "types/schemas/datasource.types";
import BoundingBox from "../bucket_data_handling/bounding_box";
import { getSupportedValueRangeForElementClass } from "../bucket_data_handling/data_rendering_logic";
import { MagInfo, convertToDenseMag } from "../helpers/mag_info";

function _getMagInfo(magnifications: Array<Vector3>): MagInfo {
  return new MagInfo(magnifications);
}

// Don't use memoizeOne here, since we want to cache the mags for all layers
// (which are not that many).
export const getMagInfo = _.memoize(_getMagInfo);

function _getMagInfoByLayer(dataset: APIDataset): Record<string, MagInfo> {
  const infos: Record<string, MagInfo> = {};

  for (const layer of dataset.dataSource.dataLayers) {
    infos[layer.name] = getMagInfo(layer.resolutions);
  }

  return infos;
}

export const getMagInfoByLayer = _.memoize(_getMagInfoByLayer);

export function getDenseMagsForLayerName(dataset: APIDataset, layerName: string) {
  return getMagInfoByLayer(dataset)[layerName].getDenseMags();
}

export const getMagnificationUnion = memoizeOne((dataset: APIDataset): Array<Vector3[]> => {
  /*
   * Returns a list of existent mags per mag level. For example:
   * [
   *    [[1, 1, 1]],
   *    [[2, 2, 2], [2, 2, 1]],
   *    [[4, 4, 4], [4, 4, 1]],
   *    [[8, 8, 8], [8, 8, 2]],
   * ]
   */
  const magUnionDict: { [key: number]: Vector3[] } = {};

  for (const layer of dataset.dataSource.dataLayers) {
    for (const mag of layer.resolutions) {
      const key = maxValue(mag);

      if (magUnionDict[key] == null) {
        magUnionDict[key] = [mag];
      } else {
        magUnionDict[key].push(mag);
      }
    }
  }

  for (const keyStr of Object.keys(magUnionDict)) {
    const key = Number(keyStr);
    magUnionDict[key] = _.uniqWith(magUnionDict[key], V3.isEqual);
  }

  const keys = Object.keys(magUnionDict)
    .sort((a, b) => Number(a) - Number(b))
    .map((el) => Number(el));

  return keys.map((key) => magUnionDict[key]);
});

export function getWidestMags(dataset: APIDataset): Vector3[] {
  const allLayerMags = dataset.dataSource.dataLayers.map((layer) =>
    convertToDenseMag(layer.resolutions),
  );

  return _.maxBy(allLayerMags, (mags) => mags.length) || [];
}

export const getSomeMagInfoForDataset = memoizeOne((dataset: APIDataset): MagInfo => {
  const magUnion = getMagnificationUnion(dataset);
  const areMagsDistinct = magUnion.every((mags) => mags.length <= 1);

  if (areMagsDistinct) {
    return new MagInfo(magUnion.map((mags) => mags[0]));
  } else {
    return new MagInfo(getWidestMags(dataset));
  }
});

function _getMaxZoomStep(dataset: APIDataset | null | undefined): number {
  const minimumZoomStepCount = 1;

  if (!dataset) {
    return minimumZoomStepCount;
  }

  const maxZoomstep = Math.max(
    minimumZoomStepCount,
    _.max(_.flattenDeep(getMagnificationUnion(dataset))) || minimumZoomStepCount,
  );

  return maxZoomstep;
}

export const getMaxZoomStep = memoizeOne(_getMaxZoomStep);
export function getDataLayers(dataset: APIDataset): DataLayerType[] {
  return dataset.dataSource.dataLayers;
}

function _getMagInfoOfVisibleSegmentationLayer(state: OxalisState): MagInfo {
  const segmentationLayer = getVisibleSegmentationLayer(state);

  if (!segmentationLayer) {
    return new MagInfo([]);
  }

  return getMagInfo(segmentationLayer.resolutions);
}

export const getMagInfoOfVisibleSegmentationLayer = memoizeOne(
  _getMagInfoOfVisibleSegmentationLayer,
);
export function getLayerByName(
  dataset: APIDataset,
  layerName: string,
  alsoMatchFallbackLayer: boolean = false,
): DataLayerType {
  const dataLayers = getDataLayers(dataset);
  const hasUniqueNames = _.uniqBy(dataLayers, "name").length === dataLayers.length;
  ErrorHandling.assert(hasUniqueNames, messages["dataset.unique_layer_names"]);
  const layer = dataLayers.find(
    (l) =>
      l.name === layerName ||
      (alsoMatchFallbackLayer && "fallbackLayer" in l && l.fallbackLayer === layerName),
  );

  if (!layer) {
    throw new Error(`Layer "${layerName}" not found`);
  }

  return layer;
}

export function getSegmentationLayerByName(
  dataset: APIDataset,
  layerName: string,
): APISegmentationLayer {
  const layer = getLayerByName(dataset, layerName);

  if (layer.category !== "segmentation") {
    throw new Error(`The requested layer with name ${layerName} is not a segmentation layer.`);
  }

  return layer;
}
export function getMappings(dataset: APIDataset, layerName: string): string[] {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'mappings' does not exist on type 'APIDat... Remove this comment to see the full error message
  return getLayerByName(dataset, layerName).mappings || [];
}
export function isRgb(dataset: APIDataset, layerName: string): boolean {
  return (
    getLayerByName(dataset, layerName).category === "color" &&
    getByteCount(dataset, layerName) === 3
  );
}
export function getByteCountFromLayer(layerInfo: DataLayerType): number {
  return getBitDepth(layerInfo) / 8;
}
export function getByteCount(dataset: APIDataset, layerName: string): number {
  return getByteCountFromLayer(getLayerByName(dataset, layerName));
}
export function getElementClass(dataset: APIDataset, layerName: string): ElementClass {
  return getLayerByName(dataset, layerName).elementClass;
}
export function getDefaultValueRangeOfLayer(
  dataset: APIDataset,
  layerName: string,
): readonly [number, number] {
  // Currently, the default range is identical to the supported range. However,
  // this might change in the future.
  return getSupportedValueRangeOfLayer(dataset, layerName);
}

export function getSupportedValueRangeOfLayer(
  dataset: APIDataset,
  layerName: string,
): readonly [number, number] {
  const elementClass = getElementClass(dataset, layerName);
  return getSupportedValueRangeForElementClass(elementClass);
}

export function getLayerBoundingBox(dataset: APIDataset, layerName: string): BoundingBox {
  /*
     The returned bounding box denotes a half-open interval. This means that min
     is included in the bounding box and max is *not* included.
  */
  const { topLeft, width, height, depth } = getLayerByName(dataset, layerName).boundingBox;
  const min = topLeft;
  const max = [topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth] as Vector3;

  return new BoundingBox({
    min,
    max,
  });
}

export function getDatasetBoundingBox(dataset: APIDataset): BoundingBox {
  const min: Vector3 = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: Vector3 = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const layers = getDataLayers(dataset);

  for (const dataLayer of layers) {
    const layerBox = getLayerBoundingBox(dataset, dataLayer.name);

    for (const i of Vector3Indicies) {
      min[i] = Math.min(min[i], layerBox.min[i]);
      max[i] = Math.max(max[i], layerBox.max[i]);
    }
  }

  return new BoundingBox({
    min,
    max,
  });
}
export function getDatasetCenter(dataset: APIDataset): Vector3 {
  return getDatasetBoundingBox(dataset).getCenter();
}
export function getDatasetExtentInVoxel(dataset: APIDataset) {
  const datasetLayers = dataset.dataSource.dataLayers;
  const allBoundingBoxes = datasetLayers.map((layer) => layer.boundingBox);
  const unifiedBoundingBoxes = aggregateBoundingBox(allBoundingBoxes);
  const { min, max } = unifiedBoundingBoxes;
  const extent = {
    topLeft: min,
    width: max[0] - min[0],
    height: max[1] - min[1],
    depth: max[2] - min[2],
    min,
    max,
  };
  return extent;
}
export function getDatasetExtentInUnit(dataset: APIDataset): BoundingBoxObject {
  const extentInVoxel = getDatasetExtentInVoxel(dataset);
  const scaleFactor = dataset.dataSource.scale.factor;
  const topLeft = extentInVoxel.topLeft.map(
    (val, index) => val * scaleFactor[index],
  ) as any as Vector3;
  const extent = {
    topLeft,
    width: extentInVoxel.width * scaleFactor[0],
    height: extentInVoxel.height * scaleFactor[1],
    depth: extentInVoxel.depth * scaleFactor[2],
  };
  return extent;
}
export function getDatasetExtentAsString(
  dataset: APIMaybeUnimportedDataset,
  inVoxel: boolean = true,
): string {
  if (!dataset.isActive) {
    return "";
  }

  if (inVoxel) {
    const extentInVoxel = getDatasetExtentInVoxel(dataset);
    return `${formatExtentInUnitWithLength(extentInVoxel, (x) => `${x}`)} voxel`;
  }

  const extent = getDatasetExtentInUnit(dataset);
  return formatExtentInUnitWithLength(extent, (length) =>
    formatNumberToLength(length, LongUnitToShortUnitMap[dataset.dataSource.scale.unit]),
  );
}
function getDatasetExtentAsProduct(extent: {
  width: number;
  height: number;
  depth: number;
}) {
  return extent.width * extent.height * extent.depth;
}
export function getDatasetExtentInVoxelAsProduct(dataset: APIDataset) {
  return getDatasetExtentAsProduct(getDatasetExtentInVoxel(dataset));
}
export function getDatasetExtentInUnitAsProduct(dataset: APIDataset) {
  return getDatasetExtentAsProduct(getDatasetExtentInUnit(dataset));
}
export function determineAllowedModes(settings?: Settings): {
  preferredMode: APIAllowedMode | null | undefined;
  allowedModes: Array<APIAllowedMode>;
} {
  // The order of allowedModes should be independent from the server and instead be similar to ViewModeValues
  const allowedModes = settings
    ? _.intersection(ViewModeValues, settings.allowedModes)
    : ViewModeValues;
  let preferredMode = null;

  if (settings?.preferredMode != null) {
    const modeId = settings.preferredMode;

    if (allowedModes.includes(modeId)) {
      preferredMode = modeId;
    }
  }

  return {
    preferredMode,
    allowedModes,
  };
}

export function getMaximumSegmentIdForLayer(dataset: APIDataset, layerName: string) {
  return getDefaultValueRangeOfLayer(dataset, layerName)[1];
}

export function isInSupportedValueRangeForLayer(
  dataset: APIDataset,
  layerName: string,
  value: number,
): boolean {
  const elementClass = getElementClass(dataset, layerName);
  const [min, max] = getSupportedValueRangeForElementClass(elementClass);
  return value >= min && value <= max;
}

export function getBitDepth(layerInfo: DataLayer | DataLayerType): number {
  switch (layerInfo.elementClass) {
    case "uint8":
      return 8;

    case "uint16":
      return 16;

    case "uint24":
      return 24;

    case "uint32":
      return 32;

    case "uint64":
      return 64;

    case "float":
      return 32;

    case "double":
      return 64;

    case "int8":
      return 8;

    case "int16":
      return 16;

    case "int32":
      return 32;

    case "int64":
      return 64;

    default:
      throw new Error("Unknown element class");
  }
}
export function isElementClassSupported(layerInfo: DataLayerType): boolean {
  // This function needs to be adapted when a new dtype should/element class needs
  // to be supported.
  switch (layerInfo.elementClass) {
    case "uint8":
    case "uint16":
    case "uint24":
    case "uint32":
    case "int8":
    case "int16":
    case "int32":
    case "float":
      return true;

    case "uint64":
    case "int64": {
      // We only support 64 bit for segmentation (note that only segment ids
      // below 2**53 - 1 will be handled properly due to the JS Number type currently).
      return layerInfo.category === "segmentation";
    }

    case "double":
    default:
      return false;
  }
}
export function isSegmentationLayer(dataset: APIDataset, layerName: string): boolean {
  return getLayerByName(dataset, layerName).category === "segmentation";
}
export function isColorLayer(dataset: APIDataset, layerName: string): boolean {
  return getLayerByName(dataset, layerName).category === "color";
}
export function getVisibleSegmentationLayer(
  state: OxalisState,
): APISegmentationLayer | null | undefined {
  const visibleSegmentationLayers = getVisibleSegmentationLayers(state);

  if (visibleSegmentationLayers.length > 0) {
    return visibleSegmentationLayers[0];
  }

  return null;
}
export function getVisibleOrLastSegmentationLayer(
  state: OxalisState,
): APISegmentationLayer | null | undefined {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  if (visibleSegmentationLayer != null) return visibleSegmentationLayer;
  const lastVisibleSegmentationLayerName =
    state.temporaryConfiguration.lastVisibleSegmentationLayerName;

  if (lastVisibleSegmentationLayerName != null) {
    return getSegmentationLayerByName(state.dataset, lastVisibleSegmentationLayerName);
  }

  return null;
}

export function hasVisibleUint64Segmentation(state: OxalisState) {
  const segmentationLayer = getVisibleSegmentationLayer(state);
  return segmentationLayer ? segmentationLayer.elementClass === "uint64" : false;
}

export function getVisibleSegmentationLayers(state: OxalisState): Array<APISegmentationLayer> {
  const { datasetConfiguration } = state;
  const { viewMode } = state.temporaryConfiguration;
  const segmentationLayers = getSegmentationLayers(state.dataset);
  const visibleSegmentationLayers = segmentationLayers.filter((layer) =>
    isLayerVisible(state.dataset, layer.name, datasetConfiguration, viewMode),
  );
  return visibleSegmentationLayers;
}

export function getSegmentationLayerWithMappingSupport(
  state: OxalisState,
): APISegmentationLayer | null | undefined {
  // Currently, webKnossos only supports one active mapping at a given time. The UI should ensure
  // that not more than one mapping is enabled (currently, this is achieved by only allowing one
  // visible segmentation layer, anyway).
  const visibleSegmentationLayers = getVisibleSegmentationLayers(state);
  // Find the visible layer with an enabled or activating mapping
  const layersWithoutDisabledMapping = visibleSegmentationLayers.filter((layer) => {
    const mappingInfo = state.temporaryConfiguration.activeMappingByLayer[layer.name];
    return mappingInfo && mappingInfo.mappingStatus !== MappingStatusEnum.DISABLED;
  });

  if (layersWithoutDisabledMapping.length > 0) {
    return layersWithoutDisabledMapping[0];
  }

  return null;
}

export function getFirstSegmentationLayer(
  dataset: APIMaybeUnimportedDataset,
): APISegmentationLayer | null | undefined {
  if (!dataset.isActive) {
    return null;
  }

  const segmentationLayers = getSegmentationLayers(dataset);

  if (segmentationLayers.length > 0) {
    return segmentationLayers[0];
  }

  return null;
}
export function getSegmentationLayers(
  dataset: APIMaybeUnimportedDataset,
): Array<APISegmentationLayer> {
  if (!dataset.isActive) {
    return [];
  }

  const segmentationLayers = dataset.dataSource.dataLayers.filter((dataLayer) =>
    isSegmentationLayer(dataset, dataLayer.name),
  ) as APISegmentationLayer[];
  return segmentationLayers;
}
export function hasSegmentation(dataset: APIDataset): boolean {
  return getSegmentationLayers(dataset).length > 0;
}
export function doesSupportVolumeWithFallback(
  dataset: APIMaybeUnimportedDataset,
  segmentationLayer: APISegmentationLayer | null | undefined,
): boolean {
  if (!dataset.isActive) {
    return false;
  }

  if (!segmentationLayer) {
    return false;
  }

  return true;
}
export function getColorLayers(dataset: APIDataset): Array<DataLayerType> {
  return dataset.dataSource.dataLayers.filter((dataLayer) => isColorLayer(dataset, dataLayer.name));
}
export function getEnabledLayers(
  dataset: APIDataset,
  datasetConfiguration: DatasetConfiguration,
  options: {
    invert?: boolean;
  } = {},
): Array<DataLayerType> {
  const dataLayers = dataset.dataSource.dataLayers;
  const layerSettings = datasetConfiguration.layers;
  return dataLayers.filter((layer) => {
    const settings = layerSettings[layer.name];

    if (settings == null) {
      return false;
    }

    return settings.isDisabled === Boolean(options.invert);
  });
}

export function getEnabledColorLayers(
  dataset: APIDataset,
  datasetConfiguration: DatasetConfiguration,
) {
  const enabledLayers = getEnabledLayers(dataset, datasetConfiguration);
  return enabledLayers.filter((layer) => isColorLayer(dataset, layer.name));
}

export function getThumbnailURL(dataset: APIDataset): string {
  const layers = dataset.dataSource.dataLayers;

  const colorLayer = _.find(layers, {
    category: "color",
  });

  if (colorLayer) {
    return `/api/datasets/${dataset.id}/layers/${colorLayer.name}/thumbnail`;
  }

  return "";
}
export function getSegmentationThumbnailURL(dataset: APIDataset): string {
  const segmentationLayer = getFirstSegmentationLayer(dataset);

  if (segmentationLayer) {
    return `/api/datasets/${dataset.id}/layers/${segmentationLayer.name}/thumbnail`;
  }

  return "";
}

export function isLayerVisible(
  dataset: APIDataset,
  layerName: string,
  datasetConfiguration: DatasetConfiguration,
  viewMode: ViewMode,
): boolean {
  const layerConfig = datasetConfiguration.layers[layerName];

  if (!layerConfig) {
    return false;
  }

  const isArbitraryMode = constants.MODES_ARBITRARY.includes(viewMode);
  const isHiddenBecauseOfArbitraryMode = isArbitraryMode && isSegmentationLayer(dataset, layerName);
  return !layerConfig.isDisabled && layerConfig.alpha > 0 && !isHiddenBecauseOfArbitraryMode;
}

export function hasFallbackLayer(layer: APIDataLayer) {
  return "fallbackLayer" in layer && layer.fallbackLayer != null;
}

function _getLayerNameToIsDisabled(datasetConfiguration: DatasetConfiguration) {
  const nameToIsDisabled: { [name: string]: boolean } = {};
  for (const layerName of Object.keys(datasetConfiguration.layers)) {
    nameToIsDisabled[layerName] = datasetConfiguration.layers[layerName].isDisabled;
  }
  return nameToIsDisabled;
}

export const getLayerNameToIsDisabled = memoizeOne(_getLayerNameToIsDisabled);

function _getUnifiedAdditionalAxes(
  mutableDataset: APIDataset,
): Record<string, Omit<AdditionalAxis, "index">> {
  /*
   * Merge additional coordinates from all layers.
   */
  const unifiedAdditionalAxes: Record<string, Omit<AdditionalAxis, "index">> = {};
  for (const layer of mutableDataset.dataSource.dataLayers) {
    const { additionalAxes } = layer;

    for (const additionalCoordinate of additionalAxes || []) {
      const { name, bounds } = additionalCoordinate;
      if (additionalCoordinate.name in unifiedAdditionalAxes) {
        const existingBounds = unifiedAdditionalAxes[name].bounds;
        unifiedAdditionalAxes[name].bounds = [
          Math.min(bounds[0], existingBounds[0]),
          Math.max(bounds[1], existingBounds[1]),
        ];
      } else {
        unifiedAdditionalAxes[name] = {
          name,
          bounds,
        };
      }
    }
  }

  return unifiedAdditionalAxes;
}

export const getUnifiedAdditionalCoordinates = memoizeOne(_getUnifiedAdditionalAxes);

export function is2dDataset(dataset: APIDataset): boolean {
  // An empty dataset (e.g., depth == 0), should not be considered as 2D.
  // This avoids that the empty dummy dataset is rendered with a 2D layout
  // which is usually switched to the 3D layout after the proper dataset has
  // been loaded.
  return getDatasetExtentInVoxel(dataset).depth === 1;
}
const dummyMapping = {
  mappingName: null,
  mapping: null,
  mappingColors: null,
  hideUnmappedIds: false,
  mappingStatus: MappingStatusEnum.DISABLED,
  mappingType: "JSON",
} as const;

export function getMappingInfoOrNull(
  activeMappingInfos: Record<string, ActiveMappingInfo>,
  layerName: string | null | undefined,
): ActiveMappingInfo | null {
  if (layerName != null && activeMappingInfos[layerName]) {
    return activeMappingInfos[layerName];
  }
  return null;
}

export function getMappingInfo(
  activeMappingInfos: Record<string, ActiveMappingInfo>,
  layerName: string | null | undefined,
): ActiveMappingInfo {
  // Return a dummy object (this mirrors webKnossos' behavior before the support of
  // multiple segmentation layers)
  return getMappingInfoOrNull(activeMappingInfos, layerName) || dummyMapping;
}
export function getMappingInfoForSupportedLayer(state: OxalisState): ActiveMappingInfo {
  const layer = getSegmentationLayerWithMappingSupport(state);
  return getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layer ? layer.name : null,
  );
}

export function getEffectiveIntensityRange(
  dataset: APIDataset,
  layerName: string,
  datasetConfiguration: DatasetConfiguration,
): readonly [number, number] {
  const defaultIntensityRange = getDefaultValueRangeOfLayer(dataset, layerName);
  const layerConfiguration = datasetConfiguration.layers[layerName];

  return layerConfiguration.intensityRange || defaultIntensityRange;
}

// Note that `hasSegmentIndex` needs to be loaded first (otherwise, the returned
// value will be undefined). Dispatch an ensureSegmentIndexIsLoadedAction to make
// sure this info is fetched.
export function getMaybeSegmentIndexAvailability(
  dataset: APIDataset,
  layerName: string | null | undefined,
) {
  if (layerName == null) {
    return false;
  }
  return dataset.dataSource.dataLayers.find((layer) => layer.name === layerName)?.hasSegmentIndex;
}

function getURLSanitizedName(dataset: APIDataset | APIDatasetCompact | { name: string }) {
  return dataset.name.replace(/[^A-Z|a-z|0-9|-|_]/g, "");
}

export function getReadableURLPart(
  dataset: APIDataset | APIDatasetCompact | { name: string; id: string },
) {
  return `${getURLSanitizedName(dataset)}-${dataset.id}`;
}

export function getDatasetIdOrNameFromReadableURLPart(datasetNameAndId: string) {
  const datasetIdOrName = datasetNameAndId.split("-").pop();
  const isId = /^[a-f0-9]{24}$/.test(datasetIdOrName || "");
  return isId
    ? { datasetId: datasetIdOrName, datasetName: null }
    : { datasetId: null, datasetName: datasetIdOrName };
}
