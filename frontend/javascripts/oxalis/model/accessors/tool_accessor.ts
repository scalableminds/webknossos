import {
  PricingPlanEnum,
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import memoizeOne from "memoize-one";
import { IdentityTransform } from "oxalis/constants";
import { getVisibleSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import { isMagRestrictionViolated } from "oxalis/model/accessors/flycam_accessor";
import {
  type AgglomerateState,
  getActiveSegmentationTracing,
  getRenderableMagForSegmentationTracing,
  hasAgglomerateMapping,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";
import type { OxalisState } from "oxalis/store";
import type { APIOrganization, APIUser } from "types/api_flow_types";
import { reuseInstanceOnEquality } from "./accessor_helpers";
import { getTransformsPerLayer } from "./dataset_layer_transformation_accessor";
import { isSkeletonLayerTransformed, isSkeletonLayerVisible } from "./skeletontracing_accessor";

abstract class AbstractAnnotationTool {
  static id: keyof typeof _AnnotationToolHelper;
  static readableName: string;
  static hasOverwriteCapabilities: boolean = false;
  static hasInterpolationCapabilities: boolean = false;
}

export type AnnotationToolId = (typeof AbstractAnnotationTool)["id"];

const _AnnotationToolHelper = {
  MOVE: "MOVE",
  SKELETON: "SKELETON",
  BRUSH: "BRUSH",
  ERASE_BRUSH: "ERASE_BRUSH",
  TRACE: "TRACE",
  ERASE_TRACE: "ERASE_TRACE",
  FILL_CELL: "FILL_CELL",
  PICK_CELL: "PICK_CELL",
  QUICK_SELECT: "QUICK_SELECT",
  BOUNDING_BOX: "BOUNDING_BOX",
  PROOFREAD: "PROOFREAD",
  LINE_MEASUREMENT: "LINE_MEASUREMENT",
  AREA_MEASUREMENT: "AREA_MEASUREMENT",
} as const;

class MoveTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.MOVE;
  readableName = "Move";
}
class SkeletonTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.SKELETON;
  readableName = "Skeleton";
}
class BrushTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.BRUSH;
  static readableName = "Brush";
}
class EraseBrushTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.ERASE_BRUSH;
  static readableName = "Erase (via Brush)";
}
class TraceTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.TRACE;
  static readableName = "Trace";
}
class EraseTraceTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.ERASE_TRACE;
  static readableName = "Erase";
}
class FillCellTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.FILL_CELL;
  static readableName = "Fill Tool";
}
class PickCellTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.PICK_CELL;
  static readableName = "Segment Picker";
}
class QuickSelectTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.QUICK_SELECT;
  static readableName = "Quick Select Tool";
}
class BoundingBoxTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.BOUNDING_BOX;
  static readableName = "Bounding Box Tool";
}
class ProofreadTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.PROOFREAD;
  static readableName = "Proofreading Tool";
}
class LineMeasurementTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.LINE_MEASUREMENT;
  static readableName = "Measurement Tool";
}
class AreaMeasurementTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.AREA_MEASUREMENT;
  static readableName = "Area Measurement Tool";
}

export const AnnotationTool = {
  MOVE: MoveTool,
  SKELETON: SkeletonTool,
  BRUSH: BrushTool,
  ERASE_BRUSH: EraseBrushTool,
  TRACE: TraceTool,
  ERASE_TRACE: EraseTraceTool,
  FILL_CELL: FillCellTool,
  PICK_CELL: PickCellTool,
  QUICK_SELECT: QuickSelectTool,
  BOUNDING_BOX: BoundingBoxTool,
  PROOFREAD: ProofreadTool,
  LINE_MEASUREMENT: LineMeasurementTool,
  AREA_MEASUREMENT: AreaMeasurementTool,
};

export type AnnotationTool = (typeof AnnotationTool)[keyof typeof AnnotationTool];

// todop: remove again
export type AnnotationToolType = AnnotationTool;
// export type AnnotationToolType = typeof AbstractAnnotationTool;

export const ToolCollections = {
  ALL_TOOLS: Object.values(AnnotationTool),
  VOLUME_TOOLS: [
    AnnotationTool.BRUSH,
    AnnotationTool.ERASE_BRUSH,
    AnnotationTool.TRACE,
    AnnotationTool.ERASE_TRACE,
    AnnotationTool.FILL_CELL,
    AnnotationTool.PICK_CELL,
    AnnotationTool.QUICK_SELECT,
  ] as AnnotationTool[],
  READ_ONLY_TOOLS: [
    AnnotationTool.MOVE,
    AnnotationTool.LINE_MEASUREMENT,
    AnnotationTool.AREA_MEASUREMENT,
  ] as AnnotationTool[],
};

export const VolumeTools = ToolCollections.VOLUME_TOOLS;

export type ToolCollection = keyof typeof ToolCollections;

export const ToolsWithOverwriteCapabilities = [
  AnnotationTool.TRACE,
  AnnotationTool.BRUSH,
  AnnotationTool.ERASE_TRACE,
  AnnotationTool.ERASE_BRUSH,
  AnnotationTool.QUICK_SELECT,
  // todop: remove as...?
] as const as AnnotationTool[];
export const ToolsWithInterpolationCapabilities = [
  AnnotationTool.TRACE,
  AnnotationTool.BRUSH,
  AnnotationTool.QUICK_SELECT,
] as const as AnnotationTool[];

export const MeasurementTools = [
  AnnotationTool.LINE_MEASUREMENT,
  AnnotationTool.AREA_MEASUREMENT,
] as const as AnnotationTool[];

export const AvailableToolsInViewMode = [...MeasurementTools, AnnotationTool.MOVE];

export type ToolWorkspace =
  | "ALL_TOOLS"
  | "READ_ONLY_TOOLS"
  | "VOLUME_ANNOTATION"
  | "SPLIT_SEGMENTS";

export function getAvailableTools(_state: OxalisState) {}

const zoomInToUseToolMessage =
  "Please zoom in further to use this tool. If you want to edit volume data on this zoom level, create an annotation with restricted magnifications from the extended annotation menu in the dashboard.";

const getExplanationForDisabledVolume = (
  isSegmentationTracingVisible: boolean,
  isInMergerMode: boolean,
  isSegmentationTracingVisibleForMag: boolean,
  isZoomInvalidForTracing: boolean,
  isEditableMappingActive: boolean,
  isSegmentationTracingTransformed: boolean,
  isJSONMappingActive: boolean,
) => {
  if (!isSegmentationTracingVisible) {
    return "Volume annotation is disabled since no segmentation tracing layer is enabled. Enable one in the left settings sidebar or make a segmentation layer editable via the lock icon.";
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

export function isVolumeDrawingTool(activeTool: AnnotationToolType): boolean {
  return (
    activeTool === AnnotationTool.TRACE ||
    activeTool === AnnotationTool.BRUSH ||
    activeTool === AnnotationTool.ERASE_TRACE ||
    activeTool === AnnotationTool.ERASE_BRUSH
  );
}
export function isBrushTool(activeTool: AnnotationToolType): boolean {
  return activeTool === AnnotationTool.BRUSH || activeTool === AnnotationTool.ERASE_BRUSH;
}
export function isTraceTool(activeTool: AnnotationToolType): boolean {
  return activeTool === AnnotationTool.TRACE || activeTool === AnnotationTool.ERASE_TRACE;
}
const noSkeletonsExplanation =
  "This annotation does not have a skeleton. Please convert it to a hybrid annotation.";

const disabledSkeletonExplanation =
  "Currently all trees are invisible. To use this tool, make the skeleton layer visible by toggling the button in the left sidebar.";

type DisabledInfo = {
  isDisabled: boolean;
  explanation: string;
};

const NOT_DISABLED_INFO = {
  isDisabled: false,
  explanation: "",
};

const ALWAYS_ENABLED_TOOL_INFOS = {
  [AnnotationTool.MOVE.id]: NOT_DISABLED_INFO,
  [AnnotationTool.LINE_MEASUREMENT.id]: NOT_DISABLED_INFO,
  [AnnotationTool.AREA_MEASUREMENT.id]: NOT_DISABLED_INFO,
  [AnnotationTool.BOUNDING_BOX.id]: NOT_DISABLED_INFO,
};

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

function _getDisabledInfoWhenVolumeIsDisabled(
  isSegmentationTracingVisible: boolean,
  isInMergerMode: boolean,
  isSegmentationTracingVisibleForMag: boolean,
  isZoomInvalidForTracing: boolean,
  isEditableMappingActive: boolean,
  isSegmentationTracingTransformed: boolean,
  isVolumeDisabled: boolean,
  isJSONMappingActive: boolean,
) {
  const genericDisabledExplanation = getExplanationForDisabledVolume(
    isSegmentationTracingVisible,
    isInMergerMode,
    isSegmentationTracingVisibleForMag,
    isZoomInvalidForTracing,
    isEditableMappingActive,
    isSegmentationTracingTransformed,
    isJSONMappingActive,
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

function getDisabledVolumeInfo(state: OxalisState) {
  // This function extracts a couple of variables from the state
  // so that it can delegate to memoized functions.
  const isInMergerMode = state.temporaryConfiguration.isMergerModeEnabled;
  const { activeMappingByLayer } = state.temporaryConfiguration;
  const isZoomInvalidForTracing = isMagRestrictionViolated(state);
  const hasVolume = state.annotation.volumes.length > 0;
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
const _getDisabledInfoForTools = (state: OxalisState): Record<AnnotationToolId, DisabledInfo> => {
  const { annotation } = state;
  const hasSkeleton = annotation.skeleton != null;
  const skeletonToolInfo = getSkeletonToolInfo(
    hasSkeleton,
    isSkeletonLayerTransformed(state),
    isSkeletonLayerVisible(annotation),
  );

  const disabledVolumeInfo = getDisabledVolumeInfo(state);
  return {
    ...ALWAYS_ENABLED_TOOL_INFOS,
    ...skeletonToolInfo,
    ...disabledVolumeInfo,
  };
};
export const getDisabledInfoForTools = reuseInstanceOnEquality(
  memoizeOne(_getDisabledInfoForTools),
);

export function adaptActiveToolToShortcuts(
  activeTool: AnnotationToolType,
  isShiftPressed: boolean,
  isControlOrMetaPressed: boolean,
  isAltPressed: boolean,
): AnnotationToolType {
  if (!isShiftPressed && !isControlOrMetaPressed && !isAltPressed) {
    // No modifier is pressed
    return activeTool;
  }

  if (
    activeTool === AnnotationTool.MOVE ||
    activeTool === AnnotationTool.QUICK_SELECT ||
    activeTool === AnnotationTool.PROOFREAD ||
    activeTool === AnnotationTool.LINE_MEASUREMENT ||
    activeTool === AnnotationTool.AREA_MEASUREMENT
  ) {
    // These tools do not have any modifier-related behavior currently (except for ALT
    // which is already handled below)
  } else if (
    activeTool === AnnotationTool.ERASE_BRUSH ||
    activeTool === AnnotationTool.ERASE_TRACE
  ) {
    if (isShiftPressed) {
      if (isControlOrMetaPressed) {
        return AnnotationTool.FILL_CELL;
      } else {
        return AnnotationTool.PICK_CELL;
      }
    }
  } else {
    if (activeTool === AnnotationTool.SKELETON) {
      // The "skeleton" tool is not changed right now (since actions such as moving a node
      // don't have a dedicated tool). The only exception is "Alt" which switches to the move tool.
      if (isAltPressed && !isControlOrMetaPressed && !isShiftPressed) {
        return AnnotationTool.MOVE;
      }

      return activeTool;
    }

    if (isShiftPressed && !isAltPressed) {
      if (!isControlOrMetaPressed) {
        // Only shift is pressed. Switch to the picker
        return AnnotationTool.PICK_CELL;
      } else {
        // Control and shift switch to the eraser
        if (activeTool === AnnotationTool.BRUSH) {
          return AnnotationTool.ERASE_BRUSH;
        } else if (activeTool === AnnotationTool.TRACE) {
          return AnnotationTool.ERASE_TRACE;
        }
      }
    }
  }

  if (isAltPressed) {
    // Alt switches to the move tool
    return AnnotationTool.MOVE;
  }

  return activeTool;
}

export const getLabelForTool = (tool: AnnotationTool) => {
  // todop
  const toolName = AnnotationTool[tool.id];
  if (toolName.readableName.endsWith("Tool")) {
    return toolName;
  }
  return `${toolName} Tool`;
};
