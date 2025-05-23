import {
  PricingPlanEnum,
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import memoizeOne from "memoize-one";
import type { APIOrganization, APIUser } from "types/api_types";
import { IdentityTransform } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { isMagRestrictionViolated, isRotated } from "viewer/model/accessors/flycam_accessor";
import type { WebknossosState } from "viewer/store";
import { reuseInstanceOnEquality } from "./accessor_helpers";
import { getTransformsPerLayer } from "./dataset_layer_transformation_accessor";
import { areGeometriesTransformed, isSkeletonLayerVisible } from "./skeletontracing_accessor";

import _ from "lodash";
import {
  type AgglomerateState,
  getActiveSegmentationTracing,
  getRenderableMagForSegmentationTracing,
  hasAgglomerateMapping,
  isVolumeAnnotationDisallowedForZoom,
} from "viewer/model/accessors/volumetracing_accessor";
import { AnnotationTool, type AnnotationToolId } from "./tool_accessor";

type DisabledInfo = {
  isDisabled: boolean;
  explanation: string;
};

const NOT_DISABLED_INFO = {
  isDisabled: false,
  explanation: "",
};

const zoomInToUseToolMessage =
  "Please zoom in further to use this tool. If you want to edit volume data on this zoom level, create an annotation with restricted magnifications from the extended annotation menu in the dashboard.";

const noSkeletonsExplanation =
  "This annotation does not have a skeleton. Please convert it to a hybrid annotation.";

const disabledSkeletonExplanation =
  "Currently all trees are invisible. To use this tool, make the skeleton layer visible by toggling the button in the left sidebar.";

const rotationActiveDisabledExplanation =
  "The tools is disabled because you are currently viewing the dataset rotated. Please reset the rotation to [0,0,0] to be able to use this tool.";

const getExplanationForDisabledVolume = (
  isSegmentationTracingVisible: boolean,
  isInMergerMode: boolean,
  isSegmentationTracingVisibleForMag: boolean,
  isZoomInvalidForTracing: boolean,
  isEditableMappingActive: boolean,
  isSegmentationTracingTransformed: boolean,
  isJSONMappingActive: boolean,
  isFlycamRotated: boolean,
) => {
  if (!isSegmentationTracingVisible) {
    return "Volume annotation is disabled since no segmentation tracing layer is enabled. Enable one in the left settings sidebar or make a segmentation layer editable via the lock icon.";
  }

  if (isFlycamRotated) {
    return rotationActiveDisabledExplanation;
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
  if (isJSONMappingActive) {
    return "Volume annotation is disabled because a JSON mapping is currently active for the the visible segmentation layer. Disable the JSON mapping to enable volume annotation.";
  }

  return "Volume annotation is currently disabled.";
};

const ALWAYS_ENABLED_TOOL_INFOS = {
  [AnnotationTool.MOVE.id]: NOT_DISABLED_INFO,
  [AnnotationTool.LINE_MEASUREMENT.id]: NOT_DISABLED_INFO,
};

function _getAreaMeasurementToolInfo(isFlycamRotated: boolean) {
  return {
    [AnnotationTool.AREA_MEASUREMENT.id]: isFlycamRotated
      ? {
          isDisabled: true,
          explanation: rotationActiveDisabledExplanation,
        }
      : NOT_DISABLED_INFO,
  };
}

const getAreaMeasurementToolInfo = memoizeOne(_getAreaMeasurementToolInfo);

function _getSkeletonToolInfo(
  hasSkeleton: boolean,
  isSkeletonLayerTransformed: boolean,
  areSkeletonsVisible: boolean,
) {
  if (!hasSkeleton) {
    return {
      [AnnotationTool.SKELETON.id]: {
        isDisabled: true,
        explanation: noSkeletonsExplanation,
      },
    };
  }

  if (!areSkeletonsVisible) {
    return {
      [AnnotationTool.SKELETON.id]: {
        isDisabled: true,
        explanation: disabledSkeletonExplanation,
      },
    };
  }

  if (isSkeletonLayerTransformed) {
    return {
      [AnnotationTool.SKELETON.id]: {
        isDisabled: true,
        explanation:
          "Skeleton annotation is disabled because the skeleton layer is transformed. Use the left sidebar to render the skeleton layer without any transformations.",
      },
    };
  }

  return {
    [AnnotationTool.SKELETON.id]: NOT_DISABLED_INFO,
  };
}
const getSkeletonToolInfo = memoizeOne(_getSkeletonToolInfo);

function _getBoundingBoxToolInfo(
  hasSkeleton: boolean,
  areGeometriesTransformed: boolean,
  isFlycamRotated: boolean,
) {
  if (isFlycamRotated) {
    return {
      [AnnotationTool.BOUNDING_BOX.id]: {
        isDisabled: true,
        explanation: rotationActiveDisabledExplanation,
      },
    };
  }
  if (areGeometriesTransformed) {
    return {
      [AnnotationTool.BOUNDING_BOX.id]: {
        isDisabled: true,
        explanation: hasSkeleton
          ? "The bounding box tool is disabled because the bounding boxes are currently transformed according to the skeleton layer. To use the tool, ensure that the skeleton layer is rendered natively in the left sidebar."
          : "The bounding box tool is disabled because the bounding boxes are rendered with transforms.",
      },
    };
  }
  return {
    [AnnotationTool.BOUNDING_BOX.id]: {
      isDisabled: false,
      explanation: "",
    },
  };
}

const getBoundingBoxToolInfo = memoizeOne(_getBoundingBoxToolInfo);

function _getDisabledInfoWhenVolumeIsDisabled(
  isSegmentationTracingVisible: boolean,
  isInMergerMode: boolean,
  isSegmentationTracingVisibleForMag: boolean,
  isZoomInvalidForTracing: boolean,
  isEditableMappingActive: boolean,
  isSegmentationTracingTransformed: boolean,
  isVolumeDisabled: boolean,
  isJSONMappingActive: boolean,
  isFlycamRotated: boolean,
) {
  const genericDisabledExplanation = getExplanationForDisabledVolume(
    isSegmentationTracingVisible,
    isInMergerMode,
    isSegmentationTracingVisibleForMag,
    isZoomInvalidForTracing,
    isEditableMappingActive,
    isSegmentationTracingTransformed,
    isJSONMappingActive,
    isFlycamRotated,
  );

  const disabledInfo = {
    isDisabled: true,
    explanation: genericDisabledExplanation,
  };
  return {
    [AnnotationTool.BRUSH.id]: disabledInfo,
    [AnnotationTool.ERASE_BRUSH.id]: disabledInfo,
    [AnnotationTool.TRACE.id]: disabledInfo,
    [AnnotationTool.ERASE_TRACE.id]: disabledInfo,
    [AnnotationTool.FILL_CELL.id]: disabledInfo,
    [AnnotationTool.QUICK_SELECT.id]: disabledInfo,
    [AnnotationTool.PICK_CELL.id]: disabledInfo,
    [AnnotationTool.PROOFREAD.id]: {
      isDisabled: isVolumeDisabled,
      explanation: genericDisabledExplanation,
    },
  };
}

function _getDisabledInfoForProofreadTool(
  hasSkeleton: boolean,
  agglomerateState: AgglomerateState,
  isProofReadingToolAllowed: boolean,
  isUneditableMappingLocked: boolean,
  activeOrganization: APIOrganization | null,
  activeUser: APIUser | null | undefined,
) {
  // The explanations are prioritized according to the effort the user has to put into
  // activating proofreading.
  // 1) If a non editable mapping is locked to the annotation, proofreading actions are
  //    not allowed for this annotation.
  // 2) If no agglomerate mapping is available (or activated), the user should know
  //    about this requirement and be able to set it up (this can be the most difficult
  //    step).
  // 3) If a mapping is available, the pricing plan is potentially warned upon.
  // 4) In the end, a potentially missing skeleton is warned upon (quite rare, because
  //    most annotations have a skeleton).
  const isDisabled =
    !hasSkeleton ||
    !agglomerateState.value ||
    !isProofReadingToolAllowed ||
    isUneditableMappingLocked;
  let explanation = "Proofreading actions are not supported after modifying the segmentation.";
  if (!isUneditableMappingLocked) {
    if (!agglomerateState.value) {
      explanation = agglomerateState.reason;
    } else if (!isProofReadingToolAllowed) {
      explanation = getFeatureNotAvailableInPlanMessage(
        PricingPlanEnum.Power,
        activeOrganization,
        activeUser,
      );
    } else {
      explanation = noSkeletonsExplanation;
    }
  } else {
    explanation =
      "A mapping that does not support proofreading actions is locked to this annotation. Most likely, the annotation layer was modified earlier (e.g. by brushing).";
  }
  return {
    isDisabled,
    explanation,
  };
}

const getDisabledInfoWhenVolumeIsDisabled = memoizeOne(_getDisabledInfoWhenVolumeIsDisabled);
const getDisabledInfoForProofreadTool = memoizeOne(_getDisabledInfoForProofreadTool);

function _getVolumeDisabledWhenVolumeIsEnabled(
  hasSkeleton: boolean,
  isZoomStepTooHighForBrushing: boolean,
  isZoomStepTooHighForTracing: boolean,
  isZoomStepTooHighForFilling: boolean,
  isUneditableMappingLocked: boolean,
  agglomerateState: AgglomerateState,
  activeOrganization: APIOrganization | null,
  activeUser: APIUser | null | undefined,
) {
  const isProofReadingToolAllowed = isFeatureAllowedByPricingPlan(
    activeOrganization,
    PricingPlanEnum.Power,
  );

  return {
    [AnnotationTool.BRUSH.id]: {
      isDisabled: isZoomStepTooHighForBrushing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationTool.ERASE_BRUSH.id]: {
      isDisabled: isZoomStepTooHighForBrushing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationTool.ERASE_TRACE.id]: {
      isDisabled: isZoomStepTooHighForTracing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationTool.TRACE.id]: {
      isDisabled: isZoomStepTooHighForTracing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationTool.FILL_CELL.id]: {
      isDisabled: isZoomStepTooHighForFilling,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationTool.PICK_CELL.id]: NOT_DISABLED_INFO,
    [AnnotationTool.QUICK_SELECT.id]: {
      isDisabled: isZoomStepTooHighForFilling,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationTool.PROOFREAD.id]: getDisabledInfoForProofreadTool(
      hasSkeleton,
      agglomerateState,
      isProofReadingToolAllowed,
      isUneditableMappingLocked,
      activeOrganization,
      activeUser,
    ),
  };
}

function getDisabledVolumeInfo(state: WebknossosState) {
  // This function extracts a couple of variables from the state
  // so that it can delegate to memoized functions.
  const isInMergerMode = state.temporaryConfiguration.isMergerModeEnabled;
  const { activeMappingByLayer } = state.temporaryConfiguration;
  const isZoomInvalidForTracing = isMagRestrictionViolated(state);
  const hasVolume = state.annotation.volumes.length > 0;
  const isFlycamRotated = isRotated(state.flycam);
  const hasSkeleton = state.annotation.skeleton != null;
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
  const isEditableMappingActive =
    segmentationTracingLayer != null && !!segmentationTracingLayer.hasEditableMapping;

  const isJSONMappingActive =
    segmentationTracingLayer != null &&
    activeMappingByLayer[segmentationTracingLayer.tracingId]?.mappingType === "JSON" &&
    activeMappingByLayer[segmentationTracingLayer.tracingId]?.mappingStatus === "ENABLED";

  const isVolumeDisabled =
    !hasVolume ||
    !isSegmentationTracingVisible ||
    isFlycamRotated ||
    // isSegmentationTracingVisibleForMag is false if isZoomInvalidForTracing is true which is why
    // this condition doesn't need to be checked here
    !isSegmentationTracingVisibleForMag ||
    isInMergerMode ||
    isJSONMappingActive ||
    isSegmentationTracingTransformed;

  const isUneditableMappingLocked =
    (segmentationTracingLayer?.mappingIsLocked && !segmentationTracingLayer?.hasEditableMapping) ??
    false;

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
        isJSONMappingActive,
        isFlycamRotated,
      )
    : // Volume tools are not ALL disabled, but some of them might be.
      getVolumeDisabledWhenVolumeIsEnabled(
        hasSkeleton,
        isVolumeAnnotationDisallowedForZoom(AnnotationTool.BRUSH, state),
        isVolumeAnnotationDisallowedForZoom(AnnotationTool.TRACE, state),
        isVolumeAnnotationDisallowedForZoom(AnnotationTool.FILL_CELL, state),
        isUneditableMappingLocked,
        hasAgglomerateMapping(state),
        state.activeOrganization,
        state.activeUser,
      );
}

const getVolumeDisabledWhenVolumeIsEnabled = memoizeOne(_getVolumeDisabledWhenVolumeIsEnabled);
const _getDisabledInfoForTools = (
  state: WebknossosState,
): Record<AnnotationToolId, DisabledInfo> => {
  const { annotation } = state;
  const hasSkeleton = annotation.skeleton != null;
  const isFlycamRotated = isRotated(state.flycam);
  const geometriesTransformed = areGeometriesTransformed(state);
  const areaMeasurementToolInfo = getAreaMeasurementToolInfo(isFlycamRotated);
  const skeletonToolInfo = getSkeletonToolInfo(
    hasSkeleton,
    geometriesTransformed,
    isSkeletonLayerVisible(annotation),
  );
  const boundingBoxInfo = getBoundingBoxToolInfo(
    hasSkeleton,
    geometriesTransformed,
    isFlycamRotated,
  );

  const disabledVolumeInfo = getDisabledVolumeInfo(state);
  return {
    ...ALWAYS_ENABLED_TOOL_INFOS,
    ...areaMeasurementToolInfo,
    ...skeletonToolInfo,
    ...disabledVolumeInfo,
    ...boundingBoxInfo,
  };
};
export const getDisabledInfoForTools = reuseInstanceOnEquality(
  memoizeOne(_getDisabledInfoForTools),
);
