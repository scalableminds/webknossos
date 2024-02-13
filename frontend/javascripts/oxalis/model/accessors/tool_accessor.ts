import memoizeOne from "memoize-one";
import { AnnotationTool, IdentityTransform } from "oxalis/constants";
import { AnnotationToolEnum } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";
import {
  AgglomerateState,
  getActiveSegmentationTracing,
  getRenderableResolutionForSegmentationTracing,
  hasAgglomerateMapping,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getTransformsPerLayer,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { isMagRestrictionViolated } from "oxalis/model/accessors/flycam_accessor";
import { APIOrganization, APIUser } from "types/api_flow_types";
import {
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { isSkeletonLayerTransformed } from "./skeletontracing_accessor";

const zoomInToUseToolMessage =
  "Please zoom in further to use this tool. If you want to edit volume data on this zoom level, create an annotation with restricted resolutions from the extended annotation menu in the dashboard.";

const getExplanationForDisabledVolume = (
  isSegmentationTracingVisible: boolean,
  isInMergerMode: boolean,
  isSegmentationTracingVisibleForMag: boolean,
  isZoomInvalidForTracing: boolean,
  isEditableMappingActive: boolean,
  isSegmentationTracingTransformed: boolean,
) => {
  if (!isSegmentationTracingVisible) {
    return "Volume annotation is disabled since no segmentation tracing layer is enabled. Enable it in the left settings sidebar.";
  }

  if (isZoomInvalidForTracing) {
    return "Volume annotation is disabled since the current zoom value is not in the required range. Please adjust the zoom level.";
  }

  if (isInMergerMode) {
    return "Volume annotation is disabled while the merger mode is active.";
  }

  if (!isSegmentationTracingVisibleForMag) {
    return "Volume annotation is disabled since no segmentation data can be shown at the current magnification. Please adjust the zoom level.";
  }

  if (isEditableMappingActive) {
    return "Volume annotation is disabled while an editable mapping is active.";
  }

  if (isSegmentationTracingTransformed) {
    return "Volume annotation is disabled because the visible segmentation layer is transformed. Use the left sidebar to render the segmentation layer without any transformations.";
  }

  return "Volume annotation is currently disabled.";
};

export function isVolumeDrawingTool(activeTool: AnnotationTool): boolean {
  return (
    activeTool === AnnotationToolEnum.TRACE ||
    activeTool === AnnotationToolEnum.BRUSH ||
    activeTool === AnnotationToolEnum.ERASE_TRACE ||
    activeTool === AnnotationToolEnum.ERASE_BRUSH
  );
}
export function isBrushTool(activeTool: AnnotationTool): boolean {
  return activeTool === AnnotationToolEnum.BRUSH || activeTool === AnnotationToolEnum.ERASE_BRUSH;
}
export function isTraceTool(activeTool: AnnotationTool): boolean {
  return activeTool === AnnotationToolEnum.TRACE || activeTool === AnnotationToolEnum.ERASE_TRACE;
}
const disabledSkeletonExplanation =
  "This annotation does not have a skeleton. Please convert it to a hybrid annotation.";

type DisabledInfo = {
  isDisabled: boolean;
  explanation: string;
};

const NOT_DISABLED_INFO = {
  isDisabled: false,
  explanation: "",
};

const ALWAYS_ENABLED_TOOL_INFOS = {
  [AnnotationToolEnum.MOVE]: NOT_DISABLED_INFO,
  [AnnotationToolEnum.LINE_MEASUREMENT]: NOT_DISABLED_INFO,
  [AnnotationToolEnum.AREA_MEASUREMENT]: NOT_DISABLED_INFO,
  [AnnotationToolEnum.BOUNDING_BOX]: NOT_DISABLED_INFO,
};

function _getSkeletonToolInfo(hasSkeleton: boolean, isSkeletonLayerTransformed: boolean) {
  if (!hasSkeleton) {
    return {
      [AnnotationToolEnum.SKELETON]: {
        isDisabled: true,
        explanation: disabledSkeletonExplanation,
      },
    };
  }

  if (isSkeletonLayerTransformed) {
    return {
      [AnnotationToolEnum.SKELETON]: {
        isDisabled: true,
        explanation:
          "Skeleton annotation is disabled because the skeleton layer is transformed. Use the left sidebar to render the skeleton layer without any transformations.",
      },
    };
  }

  return {
    [AnnotationToolEnum.SKELETON]: {
      isDisabled: false,
      explanation: "",
    },
  };
}
const getSkeletonToolInfo = memoizeOne(_getSkeletonToolInfo);

function _getDisabledInfoWhenVolumeIsDisabled(
  isSegmentationTracingVisible: boolean,
  isInMergerMode: boolean,
  isSegmentationTracingVisibleForMag: boolean,
  isZoomInvalidForTracing: boolean,
  isEditableMappingActive: boolean,
  isSegmentationTracingTransformed: boolean,
  isVolumeDisabled: boolean,
) {
  const genericDisabledExplanation = getExplanationForDisabledVolume(
    isSegmentationTracingVisible,
    isInMergerMode,
    isSegmentationTracingVisibleForMag,
    isZoomInvalidForTracing,
    isEditableMappingActive,
    isSegmentationTracingTransformed,
  );

  const disabledInfo = {
    isDisabled: true,
    explanation: genericDisabledExplanation,
  };
  return {
    [AnnotationToolEnum.BRUSH]: disabledInfo,
    [AnnotationToolEnum.ERASE_BRUSH]: disabledInfo,
    [AnnotationToolEnum.TRACE]: disabledInfo,
    [AnnotationToolEnum.ERASE_TRACE]: disabledInfo,
    [AnnotationToolEnum.FILL_CELL]: disabledInfo,
    [AnnotationToolEnum.QUICK_SELECT]: disabledInfo,
    [AnnotationToolEnum.PICK_CELL]: disabledInfo,
    [AnnotationToolEnum.PROOFREAD]: {
      isDisabled: isVolumeDisabled,
      explanation: genericDisabledExplanation,
    },
  };
}

const getDisabledInfoWhenVolumeIsDisabled = memoizeOne(_getDisabledInfoWhenVolumeIsDisabled);

function _getVolumeDisabledWhenVolumeIsEnabled(
  hasSkeleton: boolean,
  isZoomStepTooHighForBrushing: boolean,
  isZoomStepTooHighForTracing: boolean,
  isZoomStepTooHighForFilling: boolean,
  agglomerateState: AgglomerateState,
  activeOrganization: APIOrganization | null,
  activeUser: APIUser | null | undefined,
) {
  const isProofReadingToolAllowed = isFeatureAllowedByPricingPlan(
    activeOrganization,
    PricingPlanEnum.Power,
  );

  return {
    [AnnotationToolEnum.BRUSH]: {
      isDisabled: isZoomStepTooHighForBrushing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.ERASE_BRUSH]: {
      isDisabled: isZoomStepTooHighForBrushing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.ERASE_TRACE]: {
      isDisabled: isZoomStepTooHighForTracing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.TRACE]: {
      isDisabled: isZoomStepTooHighForTracing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.FILL_CELL]: {
      isDisabled: isZoomStepTooHighForFilling,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.PICK_CELL]: NOT_DISABLED_INFO,
    [AnnotationToolEnum.QUICK_SELECT]: {
      isDisabled: isZoomStepTooHighForFilling,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.PROOFREAD]: {
      isDisabled: !hasSkeleton || !agglomerateState.value || !isProofReadingToolAllowed,
      explanation:
        // The explanations are prioritized according to the effort the user has to put into
        // activating proofreading.
        // 1) If no agglomerate mapping is available (or activated), the user should know
        //    about this requirement and be able to set it up (this can be the most difficult
        //    step).
        // 2) If a mapping is available, the pricing plan is potentially warned upon.
        // 3) In the end, a potentially missing skeleton is warned upon (quite rare, because
        //    most annotations have a skeleton).
        agglomerateState.value
          ? isProofReadingToolAllowed
            ? disabledSkeletonExplanation
            : getFeatureNotAvailableInPlanMessage(
                PricingPlanEnum.Power,
                activeOrganization,
                activeUser,
              )
          : agglomerateState.reason,
    },
  };
}

function getDisabledVolumeInfo(state: OxalisState) {
  // This function extracts a couple of variables from the state
  // so that it can delegate to memoized functions.
  const isInMergerMode = state.temporaryConfiguration.isMergerModeEnabled;
  const isZoomInvalidForTracing = isMagRestrictionViolated(state);
  const hasVolume = state.tracing.volumes.length > 0;
  const hasSkeleton = state.tracing.skeleton != null;
  const segmentationTracingLayer = getActiveSegmentationTracing(state);
  const labeledResolution = getRenderableResolutionForSegmentationTracing(
    state,
    segmentationTracingLayer,
  )?.resolution;
  const isSegmentationTracingVisibleForMag = labeledResolution != null;
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
  const isEditableMappingActive =
    segmentationTracingLayer != null && !!segmentationTracingLayer.mappingIsEditable;

  const isVolumeDisabled =
    !hasVolume ||
    !isSegmentationTracingVisible ||
    // isSegmentationTracingVisibleForMag is false if isZoomInvalidForTracing is true which is why
    // this condition doesn't need to be checked here
    !isSegmentationTracingVisibleForMag ||
    isInMergerMode ||
    isSegmentationTracingTransformed;

  return isVolumeDisabled || isEditableMappingActive
    ? // All segmentation-related tools are disabled.
      getDisabledInfoWhenVolumeIsDisabled(
        isSegmentationTracingVisible,
        isInMergerMode,
        isSegmentationTracingVisibleForMag,
        isZoomInvalidForTracing,
        isEditableMappingActive,
        isSegmentationTracingTransformed,
        isVolumeDisabled,
      )
    : // Volume tools are not ALL disabled, but some of them might be.
      getVolumeDisabledWhenVolumeIsEnabled(
        hasSkeleton,
        isVolumeAnnotationDisallowedForZoom(AnnotationToolEnum.BRUSH, state),
        isVolumeAnnotationDisallowedForZoom(AnnotationToolEnum.TRACE, state),
        isVolumeAnnotationDisallowedForZoom(AnnotationToolEnum.FILL_CELL, state),
        hasAgglomerateMapping(state),
        state.activeOrganization,
        state.activeUser,
      );
}

const getVolumeDisabledWhenVolumeIsEnabled = memoizeOne(_getVolumeDisabledWhenVolumeIsEnabled);
export function getDisabledInfoForTools(
  state: OxalisState,
): Record<AnnotationToolEnum, DisabledInfo> {
  const hasSkeleton = state.tracing.skeleton != null;
  const skeletonToolInfo = getSkeletonToolInfo(hasSkeleton, isSkeletonLayerTransformed(state));

  const disabledVolumeInfo = getDisabledVolumeInfo(state);
  return {
    ...ALWAYS_ENABLED_TOOL_INFOS,
    ...skeletonToolInfo,
    ...disabledVolumeInfo,
  };
}

export function adaptActiveToolToShortcuts(
  activeTool: AnnotationTool,
  isShiftPressed: boolean,
  isControlPressed: boolean,
  isAltPressed: boolean,
): AnnotationTool {
  if (!isShiftPressed && !isControlPressed && !isAltPressed) {
    // No modifier is pressed
    return activeTool;
  }

  if (
    activeTool === AnnotationToolEnum.MOVE ||
    activeTool === AnnotationToolEnum.ERASE_BRUSH ||
    activeTool === AnnotationToolEnum.ERASE_TRACE ||
    activeTool === AnnotationToolEnum.QUICK_SELECT ||
    activeTool === AnnotationToolEnum.PROOFREAD ||
    activeTool === AnnotationToolEnum.LINE_MEASUREMENT ||
    activeTool === AnnotationToolEnum.AREA_MEASUREMENT
  ) {
    // These tools do not have any modifier-related behavior currently (except for ALT
    // which is already handled below)
  } else {
    if (activeTool === AnnotationToolEnum.SKELETON) {
      // The "skeleton" tool is not changed right now (since actions such as moving a node
      // don't have a dedicated tool). The only exception is "Alt" which switches to the move tool.
      if (isAltPressed) {
        return AnnotationToolEnum.MOVE;
      }

      return activeTool;
    }

    if (isShiftPressed && !isControlPressed && !isAltPressed) {
      // Only shift is pressed. Switch to the picker
      return AnnotationToolEnum.PICK_CELL;
    }

    if (isControlPressed && isShiftPressed && !isAltPressed) {
      // Control and shift switch to the eraser
      if (activeTool === AnnotationToolEnum.BRUSH) {
        return AnnotationToolEnum.ERASE_BRUSH;
      } else if (activeTool === AnnotationToolEnum.TRACE) {
        return AnnotationToolEnum.ERASE_TRACE;
      }
    }
  }

  if (isAltPressed) {
    // Alt switches to the move tool
    return AnnotationToolEnum.MOVE;
  }

  return activeTool;
}
