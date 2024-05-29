import memoizeOne from "memoize-one";
import type {
  APIAnnotation,
  APIAnnotationInfo,
  APIDataset,
  APISegmentationLayer,
  AdditionalCoordinate,
  AnnotationLayerDescriptor,
  ServerTracing,
  ServerVolumeTracing,
} from "types/api_flow_types";
import type {
  ActiveMappingInfo,
  HybridTracing,
  LabelAction,
  OxalisState,
  SegmentGroup,
  SegmentMap,
  Tracing,
  VolumeTracing,
} from "oxalis/store";
import { AnnotationTool, ContourMode, MappingStatusEnum, Vector3, Vector4 } from "oxalis/constants";
import { AnnotationToolEnum, VolumeTools } from "oxalis/constants";
import {
  getMappingInfo,
  getResolutionInfo,
  getSegmentationLayerByName,
  getSegmentationLayers,
  getVisibleSegmentationLayer,
  getDataLayers,
  getLayerByName,
  getVisibleOrLastSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { MAX_ZOOM_STEP_DIFF } from "oxalis/model/bucket_data_handling/loading_strategy_logic";
import {
  getFlooredPosition,
  getActiveMagIndexForLayer,
  getAdditionalCoordinatesAsString,
} from "oxalis/model/accessors/flycam_accessor";
import { reuseInstanceOnEquality } from "oxalis/model/accessors/accessor_helpers";
import { V3 } from "libs/mjs";
import { jsConvertCellIdToRGBA } from "oxalis/shaders/segmentation.glsl";
import { jsRgb2hsl } from "oxalis/shaders/utils.glsl";
import { ResolutionInfo } from "../helpers/resolution_info";
import messages from "messages";
import { MISSING_GROUP_ID } from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import { Store } from "oxalis/singletons";
import { setSelectedSegmentsOrGroupAction } from "../actions/volumetracing_actions";
import _ from "lodash";

export function getVolumeTracings(tracing: Tracing): Array<VolumeTracing> {
  return tracing.volumes;
}

export function getVolumeTracingById(tracing: Tracing, tracingId: string): VolumeTracing {
  const volumeTracing = tracing.volumes.find((t) => t.tracingId === tracingId);

  if (volumeTracing == null) {
    throw new Error(`Could not find volume tracing with id ${tracingId}`);
  }

  return volumeTracing;
}

export function getVolumeTracingLayers(dataset: APIDataset): Array<APISegmentationLayer> {
  const layers = getSegmentationLayers(dataset);
  return layers.filter((layer) => layer.tracingId != null);
}

export function getVolumeTracingByLayerName(
  tracing: Tracing,
  layerName: string,
): VolumeTracing | null | undefined {
  // Given a segmentation layer, there might be a corresponding volume tracing. In that case,
  // the layer name will be the tracing id.
  const volumeTracing = tracing.volumes.find((t) => t.tracingId === layerName);
  return volumeTracing;
}

export function hasVolumeTracings(tracing: Tracing): boolean {
  return tracing.volumes.length > 0;
}

export function getVolumeDescriptors(
  annotation: APIAnnotation | HybridTracing | APIAnnotationInfo,
): Array<AnnotationLayerDescriptor> {
  return annotation.annotationLayers.filter((layer) => layer.typ === "Volume");
}

export function getVolumeDescriptorById(
  annotation: APIAnnotation | HybridTracing,
  tracingId: string,
): AnnotationLayerDescriptor {
  const descriptors = getVolumeDescriptors(annotation).filter(
    (layer) => layer.tracingId === tracingId,
  );

  if (descriptors.length === 0) {
    throw new Error(`Could not find volume descriptor with id ${tracingId}`);
  }

  return descriptors[0];
}

export function getReadableNameByVolumeTracingId(
  annotation: APIAnnotation | HybridTracing,
  tracingId: string,
) {
  const volumeDescriptor = getVolumeDescriptorById(annotation, tracingId);
  return volumeDescriptor.name || "Volume";
}

export function getAllReadableLayerNames(dataset: APIDataset, tracing: Tracing) {
  const allReadableLayerNames = getDataLayers(dataset).map((currentLayer) =>
    "tracingId" in currentLayer && currentLayer.tracingId != null
      ? getReadableNameByVolumeTracingId(tracing, currentLayer.tracingId)
      : currentLayer.name,
  );
  if (tracing.skeleton != null) {
    allReadableLayerNames.push("Skeleton");
  }
  return allReadableLayerNames;
}

export function getReadableNameForLayerName(
  dataset: APIDataset,
  tracing: Tracing,
  layerName: string,
): string {
  const layer = getLayerByName(dataset, layerName, true);

  if ("tracingId" in layer && layer.tracingId != null) {
    return getReadableNameByVolumeTracingId(tracing, layer.tracingId);
  } else {
    return layer.name;
  }
}

export function getSegmentationLayerForTracing(
  state: OxalisState,
  volumeTracing: VolumeTracing,
): APISegmentationLayer {
  return getSegmentationLayerByName(state.dataset, volumeTracing.tracingId);
}

function _getResolutionInfoOfActiveSegmentationTracingLayer(state: OxalisState): ResolutionInfo {
  const volumeTracing = getActiveSegmentationTracing(state);

  if (!volumeTracing) {
    return new ResolutionInfo([]);
  }

  const segmentationLayer = getSegmentationLayerForTracing(state, volumeTracing);
  return getResolutionInfo(segmentationLayer.resolutions);
}

const getResolutionInfoOfActiveSegmentationTracingLayer = memoizeOne(
  _getResolutionInfoOfActiveSegmentationTracingLayer,
);
export function getServerVolumeTracings(
  tracings: Array<ServerTracing> | null | undefined,
): Array<ServerVolumeTracing> {
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'ServerTracing[]' is not assignable to type '... Remove this comment to see the full error message
  const volumeTracings: Array<ServerVolumeTracing> = (tracings || []).filter(
    (tracing) => tracing.typ === "Volume",
  );
  return volumeTracings;
}

export function getActiveCellId(volumeTracing: VolumeTracing): number {
  const { activeCellId } = volumeTracing;
  return activeCellId;
}

export function getContourTracingMode(volumeTracing: VolumeTracing): ContourMode {
  const { contourTracingMode } = volumeTracing;
  return contourTracingMode;
}

const MAG_THRESHOLDS_FOR_ZOOM: Partial<Record<AnnotationTool, number>> = {
  // Note that these are relative to the lowest existing resolution index.
  // A threshold of 1 indicates that the respective tool can be used in the
  // lowest existing resolution as well as the next highest one.
  [AnnotationToolEnum.TRACE]: 1,
  [AnnotationToolEnum.ERASE_TRACE]: 1,
  [AnnotationToolEnum.BRUSH]: 3,
  [AnnotationToolEnum.ERASE_BRUSH]: 3,
  [AnnotationToolEnum.FILL_CELL]: 1,
};
export function isVolumeTool(tool: AnnotationTool): boolean {
  return VolumeTools.indexOf(tool) > -1;
}

export function isVolumeAnnotationDisallowedForZoom(tool: AnnotationTool, state: OxalisState) {
  if (state.tracing.volumes.length === 0) {
    return true;
  }

  const threshold = MAG_THRESHOLDS_FOR_ZOOM[tool];

  if (threshold == null) {
    // If there is no threshold for the provided tool, it doesn't need to be
    // disabled.
    return false;
  }

  const activeSegmentation = getActiveSegmentationTracing(state);
  if (!activeSegmentation) {
    return true;
  }

  const volumeResolutions = getResolutionInfoOfActiveSegmentationTracingLayer(state);
  const lowestExistingResolutionIndex = volumeResolutions.getFinestResolutionIndex();
  // The current resolution is too high for the tool
  // because too many voxels could be annotated at the same time.
  const isZoomStepTooHigh =
    getActiveMagIndexForLayer(state, activeSegmentation.tracingId) >
    threshold + lowestExistingResolutionIndex;
  return isZoomStepTooHigh;
}

const MAX_BRUSH_SIZE_FOR_MAG1 = 300;
export function getMaximumBrushSize(state: OxalisState) {
  const volumeResolutions = getResolutionInfoOfActiveSegmentationTracingLayer(state);

  if (volumeResolutions.resolutions.length === 0) {
    return MAX_BRUSH_SIZE_FOR_MAG1;
  }

  const lowestExistingResolutionIndex = volumeResolutions.getFinestResolutionIndex();
  // For each leading magnification which does not exist,
  // we double the maximum brush size.
  return MAX_BRUSH_SIZE_FOR_MAG1 * 2 ** lowestExistingResolutionIndex;
}

export function getRequestedOrVisibleSegmentationLayer(
  state: OxalisState,
  layerName: string | null | undefined,
): APISegmentationLayer | null | undefined {
  const requestedLayer =
    layerName != null ? getSegmentationLayerByName(state.dataset, layerName) : null;
  return requestedLayer || getVisibleSegmentationLayer(state);
}

export function getTracingForSegmentationLayer(
  state: OxalisState,
  layer: APISegmentationLayer,
): VolumeTracing | null | undefined {
  if (layer.tracingId != null) {
    return getVolumeTracingById(state.tracing, layer.tracingId);
  } else {
    return null;
  }
}

export function getRequestedOrDefaultSegmentationTracingLayer(
  state: OxalisState,
  layerName: string | null | undefined,
): VolumeTracing | null | undefined {
  // If a layerName is passed, the corresponding volume tracing layer is returned.
  // Otherwise:
  //   if there's only one volume tracing layer, return that.
  //   else: return the visible volume tracing layer
  if (layerName != null) {
    const layer = getSegmentationLayerByName(state.dataset, layerName);
    const tracing = getTracingForSegmentationLayer(state, layer);

    if (!tracing) {
      throw new Error(
        "Requested tracing layer is not a tracing, but a disk-based segmentation layer.",
      );
    }

    return tracing;
  }

  if (state.tracing.volumes.length === 1) {
    return state.tracing.volumes[0];
  }

  const visibleLayer = getVisibleSegmentationLayer(state);

  if (visibleLayer == null) {
    return null;
  }

  return getTracingForSegmentationLayer(state, visibleLayer);
}

function _getActiveSegmentationTracing(state: OxalisState): VolumeTracing | null | undefined {
  return getRequestedOrDefaultSegmentationTracingLayer(state, null);
}

export const getActiveSegmentationTracing = memoizeOne(_getActiveSegmentationTracing);

export function getActiveSegmentationTracingLayer(
  state: OxalisState,
): APISegmentationLayer | null | undefined {
  const tracing = getRequestedOrDefaultSegmentationTracingLayer(state, null);

  if (!tracing) {
    return null;
  }

  return getSegmentationLayerForTracing(state, tracing);
}

export function enforceActiveVolumeTracing(state: OxalisState): VolumeTracing {
  const tracing = getActiveSegmentationTracing(state);

  if (tracing == null) {
    throw new Error("No volume annotation is available or enabled.");
  }

  return tracing;
}

export function getRequestedOrVisibleSegmentationLayerEnforced(
  state: OxalisState,
  layerName: string | null | undefined,
): APISegmentationLayer {
  const effectiveLayer = getRequestedOrVisibleSegmentationLayer(state, layerName);

  if (effectiveLayer != null) {
    return effectiveLayer;
  }

  // If a layerName is passed and invalid, an exception will be raised by getRequestedOrVisibleSegmentationLayer.
  throw new Error(
    "No segmentation layer is currently visible. Pass a valid layerName (you may want to use `getSegmentationLayerName`)",
  );
}

export function getNameOfRequestedOrVisibleSegmentationLayer(
  state: OxalisState,
  layerName: string | null | undefined,
): string | null | undefined {
  const layer = getRequestedOrVisibleSegmentationLayer(state, layerName);
  return layer != null ? layer.name : null;
}

export function getSegmentsForLayer(state: OxalisState, layerName: string): SegmentMap {
  const layer = getSegmentationLayerByName(state.dataset, layerName);

  if (layer.tracingId != null) {
    return getVolumeTracingById(state.tracing, layer.tracingId).segments;
  }

  return state.localSegmentationData[layer.name].segments;
}

const EMPTY_SEGMENT_GROUPS: SegmentGroup[] = [];
export function getVisibleSegments(state: OxalisState): {
  segments: SegmentMap | null | undefined;
  segmentGroups: Array<SegmentGroup>;
} {
  const layer = getVisibleSegmentationLayer(state);

  if (layer == null) {
    return { segments: null, segmentGroups: [] };
  }

  if (layer.tracingId != null) {
    const { segments, segmentGroups } = getVolumeTracingById(state.tracing, layer.tracingId);
    return { segments, segmentGroups };
  }

  // There aren't any segment groups for view-only layers
  const { segments } = state.localSegmentationData[layer.name];
  return { segments, segmentGroups: EMPTY_SEGMENT_GROUPS };
}

// Next to returning a clean list of selected segments or group, this method returns
// a callback function that updates the selectedIds in store if segments are stored
// there that are not visible in the segments view tab.
// The returned segment and group ids are all visible in the segments view tab.
function _getSelectedIds(state: OxalisState): [
  {
    segments: number[];
    group: number | null;
  },
  (() => void) | null,
] {
  // Ensure that the ids of previously selected segments are removed
  // if these segments aren't visible in the segments tab anymore.
  const nothingSelectedObject = { segments: [], group: null };
  let maybeSetSelectedSegmentsOrGroupsAction = null;
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  if (visibleSegmentationLayer == null) {
    return [nothingSelectedObject, maybeSetSelectedSegmentsOrGroupsAction];
  }
  const segmentationLayerData = state.localSegmentationData[visibleSegmentationLayer.name];
  const { segments, group } = segmentationLayerData.selectedIds;
  if (segments.length === 0 && group == null) {
    return [nothingSelectedObject, maybeSetSelectedSegmentsOrGroupsAction];
  }
  const currentVisibleSegments = getVisibleSegments(state);
  const currentSegmentIds = new Set(currentVisibleSegments?.segments?.map((segment) => segment.id));
  let cleanedSelectedGroup = null;
  if (group != null) {
    const availableGroups = currentVisibleSegments.segmentGroups
      .map((group) => group.groupId)
      .concat(MISSING_GROUP_ID);
    cleanedSelectedGroup = availableGroups.includes(group) ? group : null;
  }
  const selectedIds = {
    segments: segments.filter((id) => currentSegmentIds.has(id)),
    group: cleanedSelectedGroup,
  };
  const haveSegmentsOrGroupBeenRemovedFromList =
    selectedIds.segments.length !== segments.length || selectedIds.group !== group;
  if (haveSegmentsOrGroupBeenRemovedFromList) {
    maybeSetSelectedSegmentsOrGroupsAction = () => {
      Store.dispatch(
        setSelectedSegmentsOrGroupAction(
          selectedIds.segments,
          selectedIds.group,
          visibleSegmentationLayer.name,
        ),
      );
    };
  }
  return [selectedIds, maybeSetSelectedSegmentsOrGroupsAction];
}

export const getSelectedIds = reuseInstanceOnEquality(_getSelectedIds);

export function getActiveSegmentPosition(state: OxalisState): Vector3 | null | undefined {
  const layer = getVisibleSegmentationLayer(state);
  if (layer == null) return null;

  const volumeTracing = getVolumeTracingByLayerName(state.tracing, layer.name);
  if (volumeTracing == null) return null;

  const activeCellId = getActiveCellId(volumeTracing);
  if (activeCellId == null) return null;

  const segments = getSegmentsForLayer(state, layer.name);
  return segments.getNullable(activeCellId)?.somePosition;
}

/*
  This function returns the resolution and zoom step in which the given segmentation
  tracing layer is currently rendered (if it is rendered). These properties should be used
  when labeling volume data.
 */
function _getRenderableResolutionForSegmentationTracing(
  state: OxalisState,
  segmentationTracing: VolumeTracing | null | undefined,
):
  | {
      resolution: Vector3;
      zoomStep: number;
    }
  | null
  | undefined {
  if (!segmentationTracing) {
    return null;
  }

  const segmentationLayer = getSegmentationLayerForTracing(state, segmentationTracing);

  const requestedZoomStep = getActiveMagIndexForLayer(state, segmentationLayer.name);
  const { renderMissingDataBlack } = state.datasetConfiguration;
  const resolutionInfo = getResolutionInfo(segmentationLayer.resolutions);
  // Check whether the segmentation layer is enabled
  const segmentationSettings = state.datasetConfiguration.layers[segmentationLayer.name];

  if (segmentationSettings.isDisabled) {
    return null;
  }

  // Check whether the requested zoom step exists
  if (resolutionInfo.hasIndex(requestedZoomStep)) {
    return {
      zoomStep: requestedZoomStep,
      resolution: resolutionInfo.getResolutionByIndexOrThrow(requestedZoomStep),
    };
  }

  // Since `renderMissingDataBlack` is enabled, the fallback resolutions
  // should not be considered.
  if (renderMissingDataBlack) {
    return null;
  }

  // The current resolution is missing and fallback rendering
  // is activated. Thus, check whether one of the fallback
  // zoomSteps can be rendered.
  for (
    let fallbackZoomStep = requestedZoomStep + 1;
    fallbackZoomStep <= requestedZoomStep + MAX_ZOOM_STEP_DIFF;
    fallbackZoomStep++
  ) {
    if (resolutionInfo.hasIndex(fallbackZoomStep)) {
      return {
        zoomStep: fallbackZoomStep,
        resolution: resolutionInfo.getResolutionByIndexOrThrow(fallbackZoomStep),
      };
    }
  }

  return null;
}

export const getRenderableResolutionForSegmentationTracing = reuseInstanceOnEquality(
  _getRenderableResolutionForSegmentationTracing,
);

function _getRenderableResolutionForActiveSegmentationTracing(state: OxalisState):
  | {
      resolution: Vector3;
      zoomStep: number;
    }
  | null
  | undefined {
  const activeSegmentationTracing = getActiveSegmentationTracing(state);
  return getRenderableResolutionForSegmentationTracing(state, activeSegmentationTracing);
}

export const getRenderableResolutionForActiveSegmentationTracing = reuseInstanceOnEquality(
  _getRenderableResolutionForActiveSegmentationTracing,
);

export function getMappingInfoForVolumeTracing(
  state: OxalisState,
  // layerName instead of tracingId is also supported
  tracingId: string | null | undefined,
): ActiveMappingInfo {
  return getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId);
}

function getVolumeTracingForLayerName(
  state: OxalisState,
  layerName?: string | null | undefined,
): VolumeTracing | null | undefined {
  if (layerName != null) {
    // This needs to be checked before calling getRequestedOrDefaultSegmentationTracingLayer,
    // as the function will throw an error if layerName is given but a corresponding tracing layer
    // does not exist.
    const layer = getSegmentationLayerByName(state.dataset, layerName);
    const tracing = getTracingForSegmentationLayer(state, layer);

    if (tracing == null) return null;
  }

  const volumeTracing = getRequestedOrDefaultSegmentationTracingLayer(state, layerName);

  return volumeTracing;
}

export function hasEditableMapping(
  state: OxalisState,
  layerName?: string | null | undefined,
): boolean {
  const volumeTracing = getVolumeTracingForLayerName(state, layerName);

  if (volumeTracing == null) return false;

  return !!volumeTracing.hasEditableMapping;
}

export function isMappingLocked(
  state: OxalisState,
  layerName?: string | null | undefined,
): boolean {
  const volumeTracing = getVolumeTracingForLayerName(state, layerName);

  if (volumeTracing == null) return false;

  return !!volumeTracing.mappingIsLocked;
}

export function isMappingActivationAllowed(
  state: OxalisState,
  mappingName: string | null | undefined,
  layerName?: string | null | undefined,
): boolean {
  const isEditableMappingActive = hasEditableMapping(state, layerName);
  const isActiveMappingLocked = isMappingLocked(state, layerName);

  if (!isEditableMappingActive && !isActiveMappingLocked) return true;

  const volumeTracing = getRequestedOrDefaultSegmentationTracingLayer(state, layerName);

  // This should never be the case, since editable mappings can only be active for volume tracings
  if (volumeTracing == null) return false;

  // Only allow mapping activations of the editable mapping itself if an editable mapping is saved
  // in the volume tracing. Editable mappings cannot be disabled or switched for now.
  return mappingName === volumeTracing.mappingName;
}

export function getEditableMappingForVolumeTracingId(
  state: OxalisState,
  tracingId: string | null | undefined,
) {
  if (tracingId == null) {
    return null;
  }
  return state.tracing.mappings.find((mapping) => mapping.tracingId === tracingId);
}

export function getLastLabelAction(volumeTracing: VolumeTracing): LabelAction | undefined {
  return volumeTracing.lastLabelActions[0];
}

export function getLabelActionFromPreviousSlice(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  resolution: Vector3,
  dim: 0 | 1 | 2,
): LabelAction | undefined {
  // Gets the last label action which was performed on a different slice.
  // Note that in coarser mags (e.g., 8-8-2), the comparison of the coordinates
  // is done while respecting how the coordinates are clipped due to that resolution.
  const adapt = (vec: Vector3) => V3.roundElementToResolution(vec, resolution, dim);
  const position = adapt(getFlooredPosition(state.flycam));

  return volumeTracing.lastLabelActions.find(
    (el) => Math.floor(adapt(el.centroid)[dim]) !== position[dim],
  );
}

// Output is in [0,1] for R, G, B, and A
export function getSegmentColorAsRGBA(
  state: OxalisState,
  mappedId: number,
  layerName?: string | null | undefined,
): Vector4 {
  const segmentationLayer = getRequestedOrVisibleSegmentationLayer(state, layerName);
  if (!segmentationLayer) {
    return [1, 1, 1, 1];
  }

  const segments = getSegmentsForLayer(state, segmentationLayer.name);
  if (segments) {
    const segment = segments.getNullable(mappedId);

    if (segment?.color) {
      const [r, g, b] = segment.color;
      return [r, g, b, 1];
    }
  }

  return jsConvertCellIdToRGBA(mappedId);
}

// Output is in [0,1] for H, S, L, and A
export function getSegmentColorAsHSLA(
  state: OxalisState,
  mappedId: number,
  layerName?: string | null | undefined,
): Vector4 {
  const [r, g, b, a] = getSegmentColorAsRGBA(state, mappedId, layerName);
  const [hue, saturation, value] = jsRgb2hsl([r, g, b]);
  return [hue, saturation, value, a];
}

const AGGLOMERATE_STATES = {
  NO_SEGMENTATION: {
    value: false,
    reason: "A segmentation layer needs to be visible to load an agglomerate skeleton.",
  },
  NO_MAPPING: {
    value: false,
    reason: messages["tracing.agglomerate_skeleton.no_mapping"],
  },
  NO_AGGLOMERATE_FILE_ACTIVE: {
    value: false,
    reason: messages["tracing.agglomerate_skeleton.no_agglomerate_file_active"],
  },
  NO_AGGLOMERATE_FILE_AVAILABLE: {
    value: false,
    reason: messages["tracing.agglomerate_skeleton.no_agglomerate_file_available"],
  },
  NO_AGGLOMERATE_FILES_LOADED_YET: {
    value: false,
    reason: messages["tracing.agglomerate_skeleton.no_agglomerate_files_loaded_yet"],
  },
  YES: {
    value: true,
    reason: "",
  },
};

const CONNECTOME_STATES = {
  NO_SEGMENTATION: {
    value: false,
    reason: "A segmentation layer needs to be visible to load the synapses of a segment.",
  },
  NO_CONNECTOME_FILE: {
    value: false,
    reason: "A connectome file needs to be available to load the synapses of a segment.",
  },
  YES: {
    value: true,
    reason: "",
  },
};

export function hasConnectomeFile(state: OxalisState) {
  const segmentationLayer = getVisibleOrLastSegmentationLayer(state);

  if (segmentationLayer == null) {
    return CONNECTOME_STATES.NO_SEGMENTATION;
  }

  const { currentConnectomeFile } =
    state.localSegmentationData[segmentationLayer.name].connectomeData;

  if (currentConnectomeFile == null) {
    return CONNECTOME_STATES.NO_CONNECTOME_FILE;
  }

  return CONNECTOME_STATES.YES;
}

export type AgglomerateState = (typeof AGGLOMERATE_STATES)[keyof typeof AGGLOMERATE_STATES];

export function hasAgglomerateMapping(state: OxalisState) {
  const segmentation = getVisibleSegmentationLayer(state);

  if (!segmentation) {
    return AGGLOMERATE_STATES.NO_SEGMENTATION;
  }

  if (segmentation.agglomerates == null) {
    return AGGLOMERATE_STATES.NO_AGGLOMERATE_FILES_LOADED_YET;
  }

  if (segmentation.agglomerates.length === 0) {
    return AGGLOMERATE_STATES.NO_AGGLOMERATE_FILE_AVAILABLE;
  }

  const { mappingName, mappingType, mappingStatus } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    segmentation.name,
  );

  if (mappingName == null || mappingStatus !== MappingStatusEnum.ENABLED) {
    return AGGLOMERATE_STATES.NO_MAPPING;
  }

  if (mappingType !== "HDF5") {
    return AGGLOMERATE_STATES.NO_AGGLOMERATE_FILE_ACTIVE;
  }

  return AGGLOMERATE_STATES.YES;
}

export function getMeshesForAdditionalCoordinates(
  state: OxalisState,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
  layerName: string,
) {
  const addCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
  const meshRecords = state.localSegmentationData[layerName].meshes;
  if (meshRecords?.[addCoordKey] != null) {
    return meshRecords[addCoordKey];
  }
  return null;
}

export function getMeshesForCurrentAdditionalCoordinates(state: OxalisState, layerName: string) {
  return getMeshesForAdditionalCoordinates(state, state.flycam.additionalCoordinates, layerName);
}

export function getMeshInfoForSegment(
  state: OxalisState,
  additionalCoordinates: AdditionalCoordinate[] | null,
  layerName: string,
  segmentId: number,
) {
  const meshesForAddCoords = getMeshesForAdditionalCoordinates(
    state,
    additionalCoordinates,
    layerName,
  );
  if (meshesForAddCoords == null) return null;
  return meshesForAddCoords[segmentId];
}

export function needsLocalHdf5Mapping(state: OxalisState, layerName: string) {
  const volumeTracing = getVolumeTracingByLayerName(state.tracing, layerName);
  if (volumeTracing == null) {
    return false;
  }

  return (
    volumeTracing.hasEditableMapping ||
    state.uiInformation.activeTool === AnnotationToolEnum.PROOFREAD
  );
}

export type BucketRetrievalSource =
  | ["REQUESTED-WITHOUT-MAPPING", "NO-LOCAL-MAPPING-APPLIED"]
  | ["REQUESTED-WITHOUT-MAPPING", "LOCAL-MAPPING-APPLIED", string]
  | ["REQUESTED-WITH-MAPPING", string];

export const getBucketRetrievalSourceFn =
  // The function that is passed to memoize will only be executed once
  // per layerName. This is important since the function uses reuseInstanceOnEquality
  // to create a function that ensures that identical BucketRetrievalSource tuples will be re-used between
  // consecutive calls.
  _.memoize((layerName: string) =>
    reuseInstanceOnEquality((state: OxalisState): BucketRetrievalSource => {
      const usesLocalHdf5Mapping = needsLocalHdf5Mapping(state, layerName);

      const mappingInfo = getMappingInfoForVolumeTracing(state, layerName);

      if (
        mappingInfo.mappingStatus === MappingStatusEnum.DISABLED ||
        mappingInfo.mappingName == null
      ) {
        return ["REQUESTED-WITHOUT-MAPPING", "NO-LOCAL-MAPPING-APPLIED"];
      }

      if (usesLocalHdf5Mapping || mappingInfo.mappingType === "JSON") {
        return ["REQUESTED-WITHOUT-MAPPING", "LOCAL-MAPPING-APPLIED", mappingInfo.mappingName];
      }

      return ["REQUESTED-WITH-MAPPING", mappingInfo.mappingName];
    }),
  );
