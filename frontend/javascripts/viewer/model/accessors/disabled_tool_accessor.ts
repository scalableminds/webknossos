import {
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import memoizeOne from "memoize-one";
import type { APIOrganization, APIUser } from "types/api_types";
import { IdentityTransform } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { isMagRestrictionViolated, isRotated } from "viewer/model/accessors/flycam_accessor";
import {
  type AgglomerateState,
  getActiveSegmentationTracing,
  getRenderableMagForSegmentationTracing,
  hasAgglomerateMapping,
  isVolumeAnnotationDisallowedForZoom,
} from "viewer/model/accessors/volumetracing_accessor";
import type { WebknossosState } from "viewer/store";
import { reuseInstanceOnEquality } from "./accessor_helpers";
import { getTransformsPerLayer } from "./dataset_layer_transformation_accessor";
import { areGeometriesTransformed, isSkeletonLayerVisible } from "./skeletontracing_accessor";
import {
  AnnotationTool,
  type AnnotationToolId,
  Toolkits,
  VolumeTools,
  VolumeToolsWithProofreading,
} from "./tool_accessor";

export type DisabledInfo = {
  isDisabled: boolean;
  explanation: string;
};

const zoomInToUseToolMessage =
  "Please zoom in further to use this tool. If you want to edit volume data on this zoom level, create an annotation with restricted magnifications from the extended annotation menu in the dashboard.";

const noSkeletonsExplanation =
  "This annotation does not have a skeleton. Please convert it to a hybrid annotation.";

const disabledSkeletonExplanation =
  "Currently all trees are invisible. To use this tool, make the skeleton layer visible by toggling the button in the left sidebar.";

const rotationActiveDisabledExplanation =
  "The tool is disabled because you are currently viewing the dataset rotated. Please reset the rotation to 0,0,0 to be able to use this tool.";

const TOOL_DISABLED_BECAUSE_OF_LIVE_COLLAB_MODE =
  "is disabled because simultaneous editing is enabled in the sharing settings. Currently, only proofreading is allowed in that mode.";

type Params = {
  isSegmentationTracingVisible: boolean;
  isInMergerMode: boolean;
  isSegmentationTracingVisibleForMag: boolean;
  isZoomInvalidForTracing: boolean;
  isEditableMappingActive: boolean;
  isSegmentationTracingTransformed: boolean;
  isJSONMappingActive: boolean;
  isFlycamRotated: boolean;
  isConcurrentCollabMode: boolean;
  hasSkeleton: boolean;
  areSkeletonsVisible: boolean;
  areGeometriesTransformed: boolean;
  isZoomStepTooHighForBrushing: boolean;
  isZoomStepTooHighForTracing: boolean;
  isZoomStepTooHighForFilling: boolean;
  agglomerateState: AgglomerateState;
  isUneditableMappingLocked: boolean;
  activeOrganization: APIOrganization | null;
  activeUser: APIUser | null | undefined;
};

class DisableRule {
  affectedTools: Set<AnnotationTool>;
  constructor(
    affectedTools: AnnotationTool[],
    public validateFn: (params: Params, tool: AnnotationTool) => string | null,
  ) {
    this.affectedTools = new Set(affectedTools);
  }

  validate(tool: AnnotationTool, params: Params) {
    /* If the tool should be disabled because of the current DisableRule instance,
     * this method will return a string which is the explanation for the tool being
     * disabled.
     * If the tool doesn't need to be disabled because of the current rule, the function
     * will return null.
     */
    if (this.affectedTools.has(tool)) {
      return this.validateFn(params, tool);
    }
    return null;
  }
}

// Rules for VolumeTools (BRUSH, ERASE_BRUSH, TRACE, ERASE_TRACE, FILL_CELL, QUICK_SELECT).
const noVisibleSegmentationTracingRule = new DisableRule(
  VolumeToolsWithProofreading,
  ({ isSegmentationTracingVisible }) =>
    isSegmentationTracingVisible
      ? null
      : "Volume annotation is disabled since no segmentation tracing layer is enabled. Enable one in the left settings sidebar or make a segmentation layer editable via the lock icon.",
);

// TODO PR feedback for PRRC_kwDOAEIDNc65eIFE
const rotationVolumeRule = new DisableRule(VolumeToolsWithProofreading, ({ isFlycamRotated }) =>
  isFlycamRotated ? rotationActiveDisabledExplanation : null,
);

const zoomInvalidForTracingVolumeRule = new DisableRule(
  VolumeToolsWithProofreading,
  ({ isZoomInvalidForTracing }) =>
    isZoomInvalidForTracing
      ? "Volume annotation is disabled since the current zoom value is not in the required range. Please adjust the zoom level."
      : null,
);

const mergerModeVolumeRule = new DisableRule(VolumeToolsWithProofreading, ({ isInMergerMode }) =>
  isInMergerMode ? "Volume annotation is disabled while the merger mode is active." : null,
);

const noSegmentationForMagRule = new DisableRule(
  VolumeToolsWithProofreading,
  ({ isSegmentationTracingVisibleForMag }) =>
    isSegmentationTracingVisibleForMag
      ? null
      : "Volume annotation is disabled since no segmentation data can be shown at the current magnification. Please adjust the zoom level.",
);

// TODO PR feedback for PRRC_kwDOAEIDNc65eW-e
const editableMappingActiveRule = new DisableRule(VolumeTools, ({ isEditableMappingActive }) =>
  isEditableMappingActive
    ? "Volume annotation is disabled while an editable mapping is active."
    : null,
);

const segmentationTransformedRule = new DisableRule(
  VolumeToolsWithProofreading,
  ({ isSegmentationTracingTransformed }) =>
    isSegmentationTracingTransformed
      ? "Volume annotation is disabled because the visible segmentation layer is transformed. Use the left sidebar to render the segmentation layer without any transformations."
      : null,
);

const jsonMappingActiveRule = new DisableRule(
  VolumeToolsWithProofreading,
  ({ isJSONMappingActive }) =>
    isJSONMappingActive
      ? "Volume annotation is disabled because a JSON mapping is currently active for the the visible segmentation layer. Disable the JSON mapping to enable volume annotation."
      : null,
);

// Zoom-based rules that only apply per individual tool type when volume is not globally disabled.
// Ordered according to _getVolumeDisabledWhenVolumeIsEnabled.
const brushZoomRule = new DisableRule(
  [AnnotationTool.BRUSH, AnnotationTool.ERASE_BRUSH],
  ({ isZoomStepTooHighForBrushing }) =>
    isZoomStepTooHighForBrushing ? zoomInToUseToolMessage : null,
);

const traceZoomRule = new DisableRule(
  [AnnotationTool.TRACE, AnnotationTool.ERASE_TRACE],
  ({ isZoomStepTooHighForTracing }) =>
    isZoomStepTooHighForTracing ? zoomInToUseToolMessage : null,
);

const fillZoomRule = new DisableRule(
  [AnnotationTool.FILL_CELL, AnnotationTool.QUICK_SELECT],
  ({ isZoomStepTooHighForFilling }) =>
    isZoomStepTooHighForFilling ? zoomInToUseToolMessage : null,
);

const proofreadRule = new DisableRule([AnnotationTool.PROOFREAD], (params) => {
  const { agglomerateState, isUneditableMappingLocked, activeOrganization, activeUser } = params;

  const isAllowedByPricingPlan = isFeatureAllowedByPricingPlan(
    activeOrganization,
    PricingPlanEnum.Power,
  );

  if (isUneditableMappingLocked) {
    return "A mapping that does not support proofreading actions is locked to this annotation. Most likely, the annotation layer was modified earlier (e.g. by brushing).";
  }
  if (!agglomerateState.value) return agglomerateState.reason;
  if (!isAllowedByPricingPlan) {
    return getFeatureNotAvailableInPlanMessage(
      PricingPlanEnum.Power,
      activeOrganization,
      activeUser,
    );
  }
  return null;
});

const noSkeletonRule = new DisableRule(
  [AnnotationTool.SKELETON, AnnotationTool.PROOFREAD],
  ({ hasSkeleton }) => (hasSkeleton ? null : noSkeletonsExplanation),
);

const skeletonNotVisibleRule = new DisableRule(
  [AnnotationTool.SKELETON],
  ({ areSkeletonsVisible }) => (areSkeletonsVisible ? null : disabledSkeletonExplanation),
);

const skeletonTransformedRule = new DisableRule(
  [AnnotationTool.SKELETON],
  ({ areGeometriesTransformed }) =>
    areGeometriesTransformed
      ? "Skeleton annotation is disabled because the skeleton layer is transformed. Use the left sidebar to render the skeleton layer without any transformations."
      : null,
);

const concurrentCollabModeRule = new DisableRule(
  [AnnotationTool.SKELETON, ...VolumeTools, AnnotationTool.BOUNDING_BOX],
  ({ isConcurrentCollabMode }, tool) =>
    isConcurrentCollabMode
      ? `The ${tool.readableName} ${TOOL_DISABLED_BECAUSE_OF_LIVE_COLLAB_MODE}`
      : null,
);

const boundingBoxRotationRule = new DisableRule(
  [AnnotationTool.BOUNDING_BOX],
  ({ isFlycamRotated }) => (isFlycamRotated ? rotationActiveDisabledExplanation : null),
);

const boundingBoxTransformedRule = new DisableRule(
  [AnnotationTool.BOUNDING_BOX],
  ({ areGeometriesTransformed, hasSkeleton }) =>
    areGeometriesTransformed
      ? hasSkeleton
        ? "The bounding box tool is disabled because the bounding boxes are currently transformed according to the skeleton layer. To use the tool, ensure that the skeleton layer is rendered natively in the left sidebar."
        : "The bounding box tool is disabled because the bounding boxes are rendered with transforms."
      : null,
);

const areaMeasurementRotationRule = new DisableRule(
  [AnnotationTool.AREA_MEASUREMENT],
  ({ isFlycamRotated }) => (isFlycamRotated ? rotationActiveDisabledExplanation : null),
);

const rules = [
  // Sorted roughly by descending user-effort to enable a tool.
  proofreadRule,
  // Volume tool rules
  noVisibleSegmentationTracingRule,
  rotationVolumeRule,
  zoomInvalidForTracingVolumeRule,
  mergerModeVolumeRule,
  noSegmentationForMagRule,
  editableMappingActiveRule,
  segmentationTransformedRule,
  jsonMappingActiveRule,
  // Skeleton rules
  noSkeletonRule,
  skeletonNotVisibleRule,
  skeletonTransformedRule,
  concurrentCollabModeRule,
  // Bounding box rules
  boundingBoxRotationRule,
  boundingBoxTransformedRule,
  // Area measurement rules
  areaMeasurementRotationRule,
  // Per-tool zoom rules (only reached when volume is not globally disabled)
  brushZoomRule,
  traceZoomRule,
  fillZoomRule,
];

function getToolDisabledReason(tool: AnnotationTool, params: Params): DisabledInfo {
  for (const rule of rules) {
    const disabledReason = rule.validate(tool, params);
    if (disabledReason) {
      return { isDisabled: true, explanation: disabledReason };
    }
  }
  return { isDisabled: false, explanation: "" };
}

const _getDisabledInfoForTools = (
  state: WebknossosState,
): Record<AnnotationToolId, DisabledInfo> => {
  const { annotation } = state;
  const { activeMappingByLayer } = state.temporaryConfiguration;

  const hasSkeleton = annotation.skeleton != null;
  const isConcurrentCollabMode = annotation.collaborationMode === "Concurrent";
  const isFlycamRotated = isRotated(state.flycam);
  const isInMergerMode = state.temporaryConfiguration.isMergerModeEnabled;
  const isZoomInvalidForTracing = isMagRestrictionViolated(state);

  const segmentationTracingLayer = getActiveSegmentationTracing(state);
  const labeledMag = getRenderableMagForSegmentationTracing(state, segmentationTracingLayer)?.mag;
  const isSegmentationTracingVisibleForMag = labeledMag != null;
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  const isSegmentationTracingTransformed =
    segmentationTracingLayer != null &&
    getTransformsPerLayer(state.dataset, state.datasetConfiguration.nativelyRenderedLayerName)[
      segmentationTracingLayer.tracingId
    ] !== IdentityTransform;
  const isSegmentationTracingVisible =
    segmentationTracingLayer != null &&
    visibleSegmentationLayer != null &&
    visibleSegmentationLayer.name === segmentationTracingLayer.tracingId;
  const isEditableMappingActive = segmentationTracingLayer?.hasEditableMapping ?? false;
  const isJSONMappingActive =
    segmentationTracingLayer != null &&
    activeMappingByLayer[segmentationTracingLayer.tracingId]?.mappingType === "JSON" &&
    activeMappingByLayer[segmentationTracingLayer.tracingId]?.mappingStatus === "ENABLED";
  const isUneditableMappingLocked =
    (segmentationTracingLayer?.mappingIsLocked && !segmentationTracingLayer?.hasEditableMapping) ??
    false;

  const params: Params = {
    isSegmentationTracingVisible,
    isInMergerMode,
    isSegmentationTracingVisibleForMag,
    isZoomInvalidForTracing,
    isEditableMappingActive,
    isSegmentationTracingTransformed,
    isJSONMappingActive,
    isFlycamRotated,
    isConcurrentCollabMode,
    hasSkeleton,
    areSkeletonsVisible: isSkeletonLayerVisible(annotation),
    areGeometriesTransformed: areGeometriesTransformed(state),
    isZoomStepTooHighForBrushing: isVolumeAnnotationDisallowedForZoom(AnnotationTool.BRUSH, state),
    isZoomStepTooHighForTracing: isVolumeAnnotationDisallowedForZoom(AnnotationTool.TRACE, state),
    isZoomStepTooHighForFilling: isVolumeAnnotationDisallowedForZoom(
      AnnotationTool.FILL_CELL,
      state,
    ),
    agglomerateState: hasAgglomerateMapping(state),
    isUneditableMappingLocked,
    activeOrganization: state.activeOrganization,
    activeUser: state.activeUser,
  };

  const result = {} as Record<AnnotationToolId, DisabledInfo>;
  for (const tool of Toolkits.ALL_TOOLS) {
    result[tool.id] = getToolDisabledReason(tool, params);
  }
  return result;
};

export const getDisabledInfoForTools = reuseInstanceOnEquality(
  memoizeOne(_getDisabledInfoForTools),
);
