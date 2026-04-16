import AreaMeasurementIcon from "@images/icons/icon-area-measurement.svg?react";
import BoundingBoxIcon from "@images/icons/icon-bounding-box.svg?react";
import BrushIcon from "@images/icons/icon-brush.svg?react";
import EraserBrushIcon from "@images/icons/icon-eraser-brush.svg?react";
import EraserLassoIcon from "@images/icons/icon-eraser-lasso.svg?react";
import FillIcon from "@images/icons/icon-fill.svg?react";
import LassoIcon from "@images/icons/icon-lasso.svg?react";
import LineMeasurementIcon from "@images/icons/icon-line-measurement.svg?react";
import MoveIcon from "@images/icons/icon-move.svg?react";
import PipetteIcon from "@images/icons/icon-pipette.svg?react";
import ProofreadingIcon from "@images/icons/icon-proofreading.svg?react";
import QuickSelectToolIcon from "@images/icons/icon-quick-select.svg?react";
import SkeletonIcon from "@images/icons/icon-skeleton.svg?react";
import without from "lodash-es/without";
import type { FunctionComponent } from "react";

abstract class AbstractAnnotationTool {
  static id: keyof typeof _AnnotationToolHelper;
  static readableName: string;
  static hasOverwriteCapabilities: boolean = false;
  static hasInterpolationCapabilities: boolean = false;
  static icon: FunctionComponent | null = null;
  static description: string | null = null;
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
  VOXEL_PIPETTE: "VOXEL_PIPETTE",
  QUICK_SELECT: "QUICK_SELECT",
  BOUNDING_BOX: "BOUNDING_BOX",
  PROOFREAD: "PROOFREAD",
  LINE_MEASUREMENT: "LINE_MEASUREMENT",
  AREA_MEASUREMENT: "AREA_MEASUREMENT",
} as const;

class MoveTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.MOVE;
  static readableName = "Move Tool";
  static icon = MoveIcon;
  static description = "Use left-click to move around and right-click to open a context menu.";
}
class SkeletonTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.SKELETON;
  static readableName = "Skeleton Tool";
  static icon = SkeletonIcon;
  static description =
    "Use left-click to move around or to create/select/move nodes. Right-click opens a context menu with further options.";
}
class BrushTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.BRUSH;
  static readableName = "Brush Tool";
  static hasOverwriteCapabilities = true;
  static hasInterpolationCapabilities = true;
  static icon = BrushIcon;
  static description =
    "Draw over the voxels you would like to label. Adjust the brush size with Shift + Mousewheel.";
}
class EraseBrushTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.ERASE_BRUSH;
  static readableName = "Erase Tool (via Brush)";
  static hasOverwriteCapabilities = true;
  static icon = EraserBrushIcon;
  static description =
    "Erase the voxels by brushing over them. Adjust the brush size with Shift + Mousewheel.";
}
class TraceTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.TRACE;
  static readableName = "Trace Tool";
  static hasOverwriteCapabilities = true;
  static hasInterpolationCapabilities = true;
  static icon = LassoIcon;
  static description = "Draw outlines around the voxels you would like to label.";
}
class EraseTraceTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.ERASE_TRACE;
  static readableName = "Erase Tool";
  static hasOverwriteCapabilities = true;
  static icon = EraserLassoIcon;
  static description = "Draw outlines around the voxel you would like to erase.";
}

class FillCellTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.FILL_CELL;
  static readableName = "Fill Tool";
  static icon = FillIcon;
  static description = "Flood-fill the clicked region.";
}
class VoxelPipetteTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.VOXEL_PIPETTE;
  static readableName = "Voxel Pipette Tool";
  static icon = PipetteIcon;
  static description =
    "Inspect a voxel by showing the data values per layer in a tooltip. Clicking on a voxel will pin the tooltip to make the values selectable with the mouse cursor.";
}
class QuickSelectTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.QUICK_SELECT;
  static readableName = "Quick Select Tool";
  static hasOverwriteCapabilities = true;
  static hasInterpolationCapabilities = true;
  static icon = QuickSelectToolIcon;
  static description =
    "Click on a segment or draw a rectangle around it to automatically detect it";
}
class BoundingBoxTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.BOUNDING_BOX;
  static readableName = "Bounding Box Tool";
  static icon = BoundingBoxIcon;
  static description = "Create, resize and modify bounding boxes.";
}
class ProofreadTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.PROOFREAD;
  static readableName = "Proofreading Tool";
  static icon = ProofreadingIcon;
  static description =
    "Modify an agglomerated segmentation. Other segmentation modifications, like brushing, are not allowed if this tool is used.";
}
class LineMeasurementTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.LINE_MEASUREMENT;
  static readableName = "Measurement Tool";
  static icon = LineMeasurementIcon;
  static description = "Measure distances with connected lines by using Left Click.";
}
class AreaMeasurementTool extends AbstractAnnotationTool {
  static id = _AnnotationToolHelper.AREA_MEASUREMENT;
  static readableName = "Area Measurement Tool";
  static icon = AreaMeasurementIcon;
  static description =
    "Measure areas by using Left Drag. Avoid self-crossing polygon structure for accurate results.";
}

export const AnnotationTool = {
  MOVE: MoveTool,
  SKELETON: SkeletonTool,
  BRUSH: BrushTool,
  ERASE_BRUSH: EraseBrushTool,
  TRACE: TraceTool,
  ERASE_TRACE: EraseTraceTool,
  FILL_CELL: FillCellTool,
  VOXEL_PIPETTE: VoxelPipetteTool,
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
    AnnotationTool.VOXEL_PIPETTE,
    AnnotationTool.QUICK_SELECT,
  ] as AnnotationTool[],
  READ_ONLY_TOOLS: [
    AnnotationTool.MOVE,
    AnnotationTool.VOXEL_PIPETTE,
    AnnotationTool.LINE_MEASUREMENT,
    AnnotationTool.AREA_MEASUREMENT,
  ] as AnnotationTool[],
  SPLIT_SEGMENTS: [
    AnnotationTool.MOVE,
    AnnotationTool.SKELETON,
    AnnotationTool.FILL_CELL,
    AnnotationTool.VOXEL_PIPETTE,
    AnnotationTool.BOUNDING_BOX,
  ] as AnnotationTool[],
};

export const VolumeTools = without(
  Toolkits.VOLUME_TOOLS,
  AnnotationTool.MOVE,
  AnnotationTool.VOXEL_PIPETTE,
);

// MeasurementTools is not part of Toolkits as it should not
// be shown in the UI. Also, it's important that the MOVE tool is not in
// it because other code depends on it.
export const MeasurementTools: AnnotationTool[] = [
  AnnotationTool.LINE_MEASUREMENT,
  AnnotationTool.AREA_MEASUREMENT,
];

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
        return AnnotationTool.VOXEL_PIPETTE;
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
        return AnnotationTool.VOXEL_PIPETTE;
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
