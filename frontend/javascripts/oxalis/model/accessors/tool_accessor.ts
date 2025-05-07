import _ from "lodash";
import type { WebknossosState } from "oxalis/store";

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
  static readableName = "Move Tool";
}
class SkeletonTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.SKELETON;
  static readableName = "Skeleton Tool";
}
class BrushTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.BRUSH;
  static readableName = "Brush Tool";
  static hasOverwriteCapabilities = true;
  static hasInterpolationCapabilities = true;
}
class EraseBrushTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.ERASE_BRUSH;
  static readableName = "Erase Tool (via Brush)";
  static hasOverwriteCapabilities = true;
}
class TraceTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.TRACE;
  static readableName = "Trace Tool";
  static hasOverwriteCapabilities = true;
  static hasInterpolationCapabilities = true;
}
class EraseTraceTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.ERASE_TRACE;
  static readableName = "Erase Tool";
  static hasOverwriteCapabilities = true;
}

class FillCellTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.FILL_CELL;
  static readableName = "Fill Tool";
}
class PickCellTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.PICK_CELL;
  static readableName = "Segment Picker Tool";
}
class QuickSelectTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.QUICK_SELECT;
  static readableName = "Quick Select Tool";
  static hasOverwriteCapabilities = true;
  static hasInterpolationCapabilities = true;
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

// We also declare AnnotationTool as a type so that we can both use it as a value
// and a type.
export type AnnotationTool = (typeof AnnotationTool)[keyof typeof AnnotationTool];

export const Toolkit = {
  ALL_TOOLS: "ALL_TOOLS",
  VOLUME_TOOLS: "VOLUME_TOOLS",
  READ_ONLY_TOOLS: "READ_ONLY_TOOLS",
  SPLIT_SEGMENTS: "SPLIT_SEGMENTS",
} as const;
export type Toolkit = (typeof Toolkit)[keyof typeof Toolkit];

export const Toolkits: Record<Toolkit, AnnotationTool[]> = {
  ALL_TOOLS: Object.values(AnnotationTool) as AnnotationTool[],
  VOLUME_TOOLS: [
    AnnotationTool.MOVE,
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
  SPLIT_SEGMENTS: [
    AnnotationTool.MOVE,
    AnnotationTool.SKELETON,
    AnnotationTool.FILL_CELL,
    AnnotationTool.PICK_CELL,
    AnnotationTool.BOUNDING_BOX,
  ] as AnnotationTool[],
};

export const VolumeTools = _.without(Toolkits.VOLUME_TOOLS, AnnotationTool.MOVE);

// MeasurementTools is not part of Toolkits as it should not
// be shown in the UI. Also, it's important that the MOVE tool is not in
// it because other code depends on it.
export const MeasurementTools: AnnotationTool[] = [
  AnnotationTool.LINE_MEASUREMENT,
  AnnotationTool.AREA_MEASUREMENT,
];

export function getAvailableTools(_state: WebknossosState) {}

export function isVolumeDrawingTool(activeTool: AnnotationTool): boolean {
  return (
    activeTool === AnnotationTool.TRACE ||
    activeTool === AnnotationTool.BRUSH ||
    activeTool === AnnotationTool.ERASE_TRACE ||
    activeTool === AnnotationTool.ERASE_BRUSH
  );
}
export function isBrushTool(activeTool: AnnotationTool): boolean {
  return activeTool === AnnotationTool.BRUSH || activeTool === AnnotationTool.ERASE_BRUSH;
}
export function isTraceTool(activeTool: AnnotationTool): boolean {
  return activeTool === AnnotationTool.TRACE || activeTool === AnnotationTool.ERASE_TRACE;
}

export function adaptActiveToolToShortcuts(
  activeTool: AnnotationTool,
  isShiftPressed: boolean,
  isControlOrMetaPressed: boolean,
  isAltPressed: boolean,
): AnnotationTool {
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
