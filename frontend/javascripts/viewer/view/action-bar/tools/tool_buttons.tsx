import { useDispatch } from "react-redux";

import { useWkSelector } from "libs/react_hooks";
import { getDisabledInfoForTools } from "viewer/model/accessors/disabled_tool_accessor";
import { AnnotationTool, type AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import {
  getRenderableMagForActiveSegmentationTracing,
  hasAgglomerateMapping,
  hasEditableMapping,
} from "viewer/model/accessors/volumetracing_accessor";
import type { WebknossosState } from "viewer/store";

import FastTooltip from "components/fast_tooltip";
import features from "features";
import { ensureLayerMappingsAreLoadedAction } from "viewer/model/actions/dataset_actions";
import { IMG_STYLE_FOR_SPACEY_ICONS, ToolRadioButton } from "./tool_helpers";

type ToolButtonProps = { adaptedActiveTool: AnnotationTool };

export const ToolIdToComponent: Record<
  AnnotationToolId,
  (p: ToolButtonProps) => JSX.Element | null
> = {
  [AnnotationTool.MOVE.id]: MoveTool,
  [AnnotationTool.SKELETON.id]: SkeletonTool,
  [AnnotationTool.BRUSH.id]: BrushTool,
  [AnnotationTool.ERASE_BRUSH.id]: EraseBrushTool,
  [AnnotationTool.TRACE.id]: TraceTool,
  [AnnotationTool.ERASE_TRACE.id]: EraseTraceTool,
  [AnnotationTool.FILL_CELL.id]: FillCellTool,
  [AnnotationTool.PICK_CELL.id]: PickCellTool,
  [AnnotationTool.QUICK_SELECT.id]: QuickSelectTool,
  [AnnotationTool.BOUNDING_BOX.id]: BoundingBoxTool,
  [AnnotationTool.PROOFREAD.id]: ProofreadTool,
  [AnnotationTool.LINE_MEASUREMENT.id]: LineMeasurementTool,
  [AnnotationTool.AREA_MEASUREMENT.id]: () => null,
};

function MaybeMultiSliceAnnotationInfoIcon() {
  const maybeMagWithZoomStep = useWkSelector(getRenderableMagForActiveSegmentationTracing);
  const labeledMag = maybeMagWithZoomStep != null ? maybeMagWithZoomStep.mag : null;
  const hasMagWithHigherDimension = (labeledMag || []).some((val) => val > 1);
  const maybeMultiSliceAnnotationInfoIcon = hasMagWithHigherDimension ? (
    <FastTooltip title="You are annotating in a low magnification. Depending on the used viewport, you might be annotating multiple slices at once.">
      <i
        className="fas fa-layer-group"
        style={{
          marginLeft: 4,
        }}
      />
    </FastTooltip>
  ) : null;
  return maybeMultiSliceAnnotationInfoIcon;
}

export function MoveTool(_props: ToolButtonProps) {
  return (
    <ToolRadioButton
      name={AnnotationTool.MOVE.readableName}
      description="Use left-click to move around and right-click to open a context menu."
      disabledExplanation=""
      disabled={false}
      value={AnnotationTool.MOVE}
    >
      <i className="fas fa-arrows-alt" />
    </ToolRadioButton>
  );
}

export function SkeletonTool(_props: ToolButtonProps) {
  const useLegacyBindings = useWkSelector((state) => state.userConfiguration.useLegacyBindings);
  const skeletonToolDescription = useLegacyBindings
    ? "Use left-click to move around and right-click to create new skeleton nodes"
    : "Use left-click to move around or to create/select/move nodes. Right-click opens a context menu with further options.";
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const hasSkeleton = useWkSelector((state) => state.annotation?.skeleton != null);
  const isReadOnly = useWkSelector((state) => !state.annotation.restrictions.allowUpdate);

  if (!hasSkeleton || isReadOnly) {
    return null;
  }

  return (
    <ToolRadioButton
      name={AnnotationTool.SKELETON.readableName}
      description={skeletonToolDescription}
      disabledExplanation={disabledInfosForTools[AnnotationTool.SKELETON.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.SKELETON.id].isDisabled}
      value={AnnotationTool.SKELETON}
    >
      <i
        style={{
          opacity: disabledInfosForTools[AnnotationTool.SKELETON.id].isDisabled ? 0.5 : 1,
        }}
        className="fas fa-project-diagram"
      />
    </ToolRadioButton>
  );
}

function getIsVolumeModificationAllowed(state: WebknossosState) {
  const isReadOnly = !state.annotation.restrictions.allowUpdate;
  const hasVolume = state.annotation?.volumes.length > 0;
  return hasVolume && !isReadOnly && !hasEditableMapping(state);
}

export function BrushTool({ adaptedActiveTool }: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }
  return (
    <ToolRadioButton
      name={AnnotationTool.BRUSH.readableName}
      description={
        "Draw over the voxels you would like to label. Adjust the brush size with Shift + Mousewheel."
      }
      disabledExplanation={disabledInfosForTools[AnnotationTool.BRUSH.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.BRUSH.id].isDisabled}
      value={AnnotationTool.BRUSH}
    >
      <i
        className="fas fa-paint-brush"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.BRUSH.id].isDisabled ? 0.5 : 1,
        }}
      />
      {adaptedActiveTool === AnnotationTool.BRUSH ? <MaybeMultiSliceAnnotationInfoIcon /> : null}
    </ToolRadioButton>
  );
}

export function EraseBrushTool({ adaptedActiveTool }: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const showEraseTraceTool =
    adaptedActiveTool === AnnotationTool.TRACE || adaptedActiveTool === AnnotationTool.ERASE_TRACE;
  const showEraseBrushTool = !showEraseTraceTool;

  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }

  return (
    <ToolRadioButton
      name={AnnotationTool.ERASE_BRUSH.readableName}
      description="Erase the voxels by brushing over them. Adjust the brush size with Shift + Mousewheel."
      disabledExplanation={disabledInfosForTools[AnnotationTool.ERASE_BRUSH.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.ERASE_BRUSH.id].isDisabled}
      style={{
        marginLeft: showEraseBrushTool ? 0 : -38,
        zIndex: showEraseBrushTool ? "initial" : -10,
        transition: "margin 0.3s",
      }}
      value={AnnotationTool.ERASE_BRUSH}
    >
      <i
        className="fas fa-eraser"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.ERASE_BRUSH.id].isDisabled ? 0.5 : 1,
        }}
      />
      {adaptedActiveTool === AnnotationTool.ERASE_BRUSH ? (
        <MaybeMultiSliceAnnotationInfoIcon />
      ) : null}
    </ToolRadioButton>
  );
}

export function TraceTool({ adaptedActiveTool }: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }
  return (
    <ToolRadioButton
      name={AnnotationTool.TRACE.readableName}
      description="Draw outlines around the voxels you would like to label."
      disabledExplanation={disabledInfosForTools[AnnotationTool.TRACE.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.TRACE.id].isDisabled}
      value={AnnotationTool.TRACE}
    >
      <img
        src="/assets/images/lasso.svg"
        alt="Trace Tool Icon"
        style={{
          marginRight: 4,
          opacity: disabledInfosForTools[AnnotationTool.TRACE.id].isDisabled ? 0.5 : 1,
          ...IMG_STYLE_FOR_SPACEY_ICONS,
        }}
      />
      {adaptedActiveTool === AnnotationTool.TRACE ? <MaybeMultiSliceAnnotationInfoIcon /> : null}
    </ToolRadioButton>
  );
}

export function EraseTraceTool({ adaptedActiveTool }: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const showEraseTraceTool =
    adaptedActiveTool === AnnotationTool.TRACE || adaptedActiveTool === AnnotationTool.ERASE_TRACE;
  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }

  return (
    <ToolRadioButton
      name={AnnotationTool.ERASE_TRACE.readableName}
      description="Draw outlines around the voxel you would like to erase."
      disabledExplanation={disabledInfosForTools[AnnotationTool.ERASE_TRACE.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.ERASE_TRACE.id].isDisabled}
      style={{
        marginLeft: showEraseTraceTool ? 0 : -38,
        zIndex: showEraseTraceTool ? "initial" : -10,
        transition: "margin 0.3s",
      }}
      value={AnnotationTool.ERASE_TRACE}
    >
      <i
        className="fas fa-eraser"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.ERASE_TRACE.id].isDisabled ? 0.5 : 1,
        }}
      />
      {adaptedActiveTool === AnnotationTool.ERASE_TRACE ? (
        <MaybeMultiSliceAnnotationInfoIcon />
      ) : null}
    </ToolRadioButton>
  );
}

export function FillCellTool({ adaptedActiveTool }: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }

  return (
    <ToolRadioButton
      name={AnnotationTool.FILL_CELL.readableName}
      description="Flood-fill the clicked region."
      disabledExplanation={disabledInfosForTools[AnnotationTool.FILL_CELL.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.FILL_CELL.id].isDisabled}
      value={AnnotationTool.FILL_CELL}
    >
      <i
        className="fas fa-fill-drip"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.FILL_CELL.id].isDisabled ? 0.5 : 1,
          transform: "scaleX(-1)",
        }}
      />
      {adaptedActiveTool === AnnotationTool.FILL_CELL ? (
        <MaybeMultiSliceAnnotationInfoIcon />
      ) : null}
    </ToolRadioButton>
  );
}

export function PickCellTool(_props: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }
  return (
    <ToolRadioButton
      name={AnnotationTool.PICK_CELL.readableName}
      description="Click on a voxel to make its segment id the active segment id."
      disabledExplanation={disabledInfosForTools[AnnotationTool.PICK_CELL.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.PICK_CELL.id].isDisabled}
      value={AnnotationTool.PICK_CELL}
    >
      <i
        className="fas fa-eye-dropper"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.PICK_CELL.id].isDisabled ? 0.5 : 1,
        }}
      />
    </ToolRadioButton>
  );
}

export function QuickSelectTool(_props: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }
  return (
    <ToolRadioButton
      name={AnnotationTool.QUICK_SELECT.readableName}
      description="Click on a segment or draw a rectangle around it to automatically detect it"
      disabledExplanation={disabledInfosForTools[AnnotationTool.QUICK_SELECT.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.QUICK_SELECT.id].isDisabled}
      value={AnnotationTool.QUICK_SELECT}
    >
      <img
        src="/assets/images/quick-select-tool.svg"
        alt="Quick Select Icon"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.QUICK_SELECT.id].isDisabled ? 0.5 : 1,
          ...IMG_STYLE_FOR_SPACEY_ICONS,
        }}
      />
    </ToolRadioButton>
  );
}

export function BoundingBoxTool(_props: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const isReadOnly = useWkSelector((state) => !state.annotation.restrictions.allowUpdate);
  if (isReadOnly) {
    return null;
  }
  return (
    <ToolRadioButton
      name={AnnotationTool.BOUNDING_BOX.readableName}
      description="Create, resize and modify bounding boxes."
      disabledExplanation={disabledInfosForTools[AnnotationTool.BOUNDING_BOX.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.BOUNDING_BOX.id].isDisabled}
      value={AnnotationTool.BOUNDING_BOX}
    >
      <img
        src="/assets/images/bounding-box.svg"
        alt="Bounding Box Icon"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.BOUNDING_BOX.id].isDisabled ? 0.5 : 1,
          ...IMG_STYLE_FOR_SPACEY_ICONS,
        }}
      />
    </ToolRadioButton>
  );
}

export function ProofreadTool(_props: ToolButtonProps) {
  const dispatch = useDispatch();
  const isAgglomerateMappingEnabled = useWkSelector(hasAgglomerateMapping);
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const areEditableMappingsEnabled = features().editableMappingsEnabled;
  const hasSkeleton = useWkSelector((state) => state.annotation?.skeleton != null);
  const hasVolume = useWkSelector((state) => state.annotation?.volumes.length > 0);
  const isReadOnly = useWkSelector((state) => !state.annotation.restrictions.allowUpdate);

  const mayProofread = hasSkeleton && hasVolume && !isReadOnly;
  if (!mayProofread) {
    return null;
  }

  return (
    <ToolRadioButton
      name={AnnotationTool.PROOFREAD.readableName}
      description={
        "Modify an agglomerated segmentation. Other segmentation modifications, like brushing, are not allowed if this tool is used."
      }
      disabledExplanation={
        areEditableMappingsEnabled
          ? isAgglomerateMappingEnabled.reason ||
            disabledInfosForTools[AnnotationTool.PROOFREAD.id].explanation
          : "Proofreading tool is only available on webknossos.org"
      }
      disabled={
        !areEditableMappingsEnabled ||
        !isAgglomerateMappingEnabled.value ||
        disabledInfosForTools[AnnotationTool.PROOFREAD.id].isDisabled
      }
      value={AnnotationTool.PROOFREAD}
      onMouseEnter={() => {
        dispatch(ensureLayerMappingsAreLoadedAction());
      }}
    >
      <i
        className="fas fa-clipboard-check"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.PROOFREAD.id].isDisabled ? 0.5 : 1,
          padding: "0 4px",
        }}
      />
    </ToolRadioButton>
  );
}

export function LineMeasurementTool(_props: ToolButtonProps) {
  return (
    <ToolRadioButton
      name={AnnotationTool.LINE_MEASUREMENT.readableName}
      description="Use to measure distances or areas."
      disabledExplanation=""
      disabled={false}
      value={AnnotationTool.LINE_MEASUREMENT}
    >
      <i className="fas fa-ruler" />
    </ToolRadioButton>
  );
}
