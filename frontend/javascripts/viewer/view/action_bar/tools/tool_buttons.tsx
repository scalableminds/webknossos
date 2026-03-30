import Icon, { CaretDownOutlined } from "@ant-design/icons";
import AreaMeasurementIcon from "@images/icons/icon-area-measurement.svg?react";
import BoundingBoxIcon from "@images/icons/icon-bounding-box.svg?react";
import BrushIcon from "@images/icons/icon-brush.svg?react";
import EraserBrushIcon from "@images/icons/icon-eraser-brush.svg?react";
import EraserLassoIcon from "@images/icons/icon-eraser-lasso.svg?react";
import FillIcon from "@images/icons/icon-fill.svg?react";
import LassoIcon from "@images/icons/icon-lasso.svg?react";
import LayerGroupIcon from "@images/icons/icon-layer-group.svg?react";
import LineMeasurementIcon from "@images/icons/icon-line-measurement.svg?react";
import MoveIcon from "@images/icons/icon-move.svg?react";
import PipetteIcon from "@images/icons/icon-pipette.svg?react";
import ProofreadingIcon from "@images/icons/icon-proofreading.svg?react";
import QuickSelectToolIcon from "@images/icons/icon-quick-select.svg?react";
import SkeletonIcon from "@images/icons/icon-skeleton.svg?react";
import { Dropdown } from "antd";
import FastTooltip from "components/fast_tooltip";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import type { ReactElement } from "react";
import { useDispatch } from "react-redux";
import { getDisabledInfoForTools } from "viewer/model/accessors/disabled_tool_accessor";
import { AnnotationTool, type AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import {
  getRenderableMagForActiveSegmentationTracing,
  hasAgglomerateMapping,
  hasEditableMapping,
} from "viewer/model/accessors/volumetracing_accessor";
import { ensureLayerMappingsAreLoadedAction } from "viewer/model/actions/dataset_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import type { WebknossosState } from "viewer/store";
import { NARROW_BUTTON_STYLE, ToolRadioButton } from "./tool_helpers";

const MAYBE_DISABLED_BUTTON_STYLE = { opacity: 0.5 };

type ToolButtonProps = { adaptedActiveTool: AnnotationTool };

export const ToolIdToComponent: Record<
  AnnotationToolId,
  (p: ToolButtonProps) => ReactElement | null
> = {
  [AnnotationTool.MOVE.id]: MoveTool,
  [AnnotationTool.SKELETON.id]: SkeletonTool,
  [AnnotationTool.BRUSH.id]: BrushToolMenu,
  [AnnotationTool.ERASE_BRUSH.id]: EraseToolMenu,
  [AnnotationTool.TRACE.id]: () => null,
  [AnnotationTool.ERASE_TRACE.id]: () => null,
  [AnnotationTool.FILL_CELL.id]: FillCellTool,
  [AnnotationTool.VOXEL_PIPETTE.id]: VoxelPipetteTool,
  [AnnotationTool.QUICK_SELECT.id]: QuickSelectTool,
  [AnnotationTool.BOUNDING_BOX.id]: BoundingBoxTool,
  [AnnotationTool.PROOFREAD.id]: ProofreadTool,
  [AnnotationTool.LINE_MEASUREMENT.id]: MeasurementToolMenu,
  [AnnotationTool.AREA_MEASUREMENT.id]: () => null,
};

function MaybeMultiSliceAnnotationInfoIcon() {
  const maybeMagWithZoomStep = useWkSelector(getRenderableMagForActiveSegmentationTracing);
  const labeledMag = maybeMagWithZoomStep != null ? maybeMagWithZoomStep.mag : null;
  const hasMagWithHigherDimension = (labeledMag || []).some((val) => val > 1);
  const maybeMultiSliceAnnotationInfoIcon = hasMagWithHigherDimension ? (
    <FastTooltip title="You are annotating in a low magnification. Depending on the used viewport, you might be annotating multiple slices at once.">
      <Icon
        component={LayerGroupIcon}
        style={{
          marginLeft: 4,
        }}
      />
    </FastTooltip>
  ) : null;
  return maybeMultiSliceAnnotationInfoIcon;
}

function MoveTool(_props: ToolButtonProps) {
  return (
    <ToolRadioButton
      name={AnnotationTool.MOVE.readableName}
      description="Use left-click to move around and right-click to open a context menu."
      disabledExplanation=""
      disabled={false}
      value={AnnotationTool.MOVE.id}
    >
      <Icon component={MoveIcon} />
    </ToolRadioButton>
  );
}

function SkeletonTool(_props: ToolButtonProps) {
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
      value={AnnotationTool.SKELETON.id}
    >
      <Icon
        component={SkeletonIcon}
        style={{
          opacity: disabledInfosForTools[AnnotationTool.SKELETON.id].isDisabled ? 0.5 : 1,
        }}
      />
    </ToolRadioButton>
  );
}

function getIsVolumeModificationAllowed(state: WebknossosState) {
  const isReadOnly = !state.annotation.restrictions.allowUpdate;
  const hasVolume = state.annotation?.volumes.length > 0;
  return hasVolume && !isReadOnly && !hasEditableMapping(state);
}

function BrushToolMenu({ adaptedActiveTool }: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const dispatch = useDispatch();
  const brushPreference = useWkSelector((state) => state.userConfiguration.writePreference);

  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }

  const isBrushDisabled = disabledInfosForTools[AnnotationTool.BRUSH.id].isDisabled;
  const isTraceDisabled = disabledInfosForTools[AnnotationTool.TRACE.id].isDisabled;
  const maybeDisabledBrushButtonStyle = isBrushDisabled ? MAYBE_DISABLED_BUTTON_STYLE : {};
  const maybeDisabledTraceButtonStyle = isTraceDisabled ? MAYBE_DISABLED_BUTTON_STYLE : {};
  const maybeBothDisabledStyle =
    isBrushDisabled && isTraceDisabled ? MAYBE_DISABLED_BUTTON_STYLE : {};

  return (
    <ToolRadioButton
      name={AnnotationTool.BRUSH.readableName}
      disabledExplanation={disabledInfosForTools[AnnotationTool.BRUSH.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.BRUSH.id].isDisabled}
      value={AnnotationTool.BRUSH.id}
    >
      <Dropdown
        menu={{
          items: [
            {
              key: AnnotationTool.BRUSH.id,
              label: "Brush",
              icon: <Icon component={BrushIcon} style={maybeDisabledBrushButtonStyle} />,
              disabled: isBrushDisabled,
              title: isBrushDisabled
                ? disabledInfosForTools[AnnotationTool.BRUSH.id].explanation
                : "Draw over the voxels you would like to label. Adjust the brush size with Shift + Mousewheel.",
            },
            {
              key: AnnotationTool.TRACE.id,
              label: "Trace",
              icon: <Icon component={LassoIcon} style={maybeDisabledTraceButtonStyle} />,
              disabled: isTraceDisabled,
              title: isTraceDisabled
                ? disabledInfosForTools[AnnotationTool.TRACE.id].explanation
                : "Draw outlines around the voxels you would like to label.",
            },
          ],
          onClick: (key) => dispatch(setToolAction(AnnotationTool[key.key as AnnotationToolId])),
        }}
        trigger={["hover"]}
      >
        {brushPreference === "BRUSH" ? (
          <Icon component={BrushIcon} style={maybeDisabledBrushButtonStyle} />
        ) : (
          <Icon component={LassoIcon} style={maybeDisabledTraceButtonStyle} />
        )}
      </Dropdown>
      <CaretDownOutlined className="triangle-icon" style={maybeBothDisabledStyle} />
      {adaptedActiveTool === AnnotationTool.BRUSH || adaptedActiveTool === AnnotationTool.TRACE ? (
        <MaybeMultiSliceAnnotationInfoIcon />
      ) : null}
    </ToolRadioButton>
  );
}

function EraseToolMenu({ adaptedActiveTool }: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const dispatch = useDispatch();
  const erasePreference = useWkSelector((state) => state.userConfiguration.erasePreference);

  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }
  const isEraseBrushDisabled = disabledInfosForTools[AnnotationTool.ERASE_BRUSH.id].isDisabled;
  const isEraseTraceDisabled = disabledInfosForTools[AnnotationTool.ERASE_TRACE.id].isDisabled;
  const maybeDisabledEraseBrushButtonStyle = isEraseBrushDisabled
    ? MAYBE_DISABLED_BUTTON_STYLE
    : {};
  const maybeDisabledEraseTraceButtonStyle = isEraseTraceDisabled
    ? MAYBE_DISABLED_BUTTON_STYLE
    : {};
  const maybeBothDisabledStyle =
    isEraseBrushDisabled && isEraseTraceDisabled ? MAYBE_DISABLED_BUTTON_STYLE : {};
  return (
    <ToolRadioButton
      name={AnnotationTool.ERASE_BRUSH.readableName}
      disabledExplanation={disabledInfosForTools[AnnotationTool.ERASE_BRUSH.id].explanation}
      value={
        erasePreference === "ERASE_BRUSH"
          ? AnnotationTool.ERASE_BRUSH.id
          : AnnotationTool.ERASE_TRACE.id
      }
    >
      <Dropdown
        menu={{
          items: [
            {
              key: AnnotationTool.ERASE_BRUSH.id,
              label: "Erase Brush",
              icon: <Icon component={EraserBrushIcon} style={maybeDisabledEraseBrushButtonStyle} />,
              disabled: isEraseBrushDisabled,
              title: isEraseBrushDisabled
                ? disabledInfosForTools[AnnotationTool.ERASE_BRUSH.id].explanation
                : "Erase the voxels by brushing over them. Adjust the brush size with Shift + Mousewheel.",
            },
            {
              key: AnnotationTool.ERASE_TRACE.id,
              label: "Erase Trace",
              icon: <Icon component={EraserLassoIcon} style={maybeDisabledEraseTraceButtonStyle} />,
              disabled: isEraseTraceDisabled,
              title: isEraseTraceDisabled
                ? disabledInfosForTools[AnnotationTool.ERASE_TRACE.id].explanation
                : "Draw outlines around the voxel you would like to erase.",
            },
          ],
          onClick: (key) => dispatch(setToolAction(AnnotationTool[key.key as AnnotationToolId])),
        }}
        trigger={["hover"]}
      >
        {erasePreference === "ERASE_BRUSH" ? (
          <Icon component={EraserBrushIcon} style={maybeDisabledEraseBrushButtonStyle} />
        ) : (
          <Icon component={EraserLassoIcon} style={maybeDisabledEraseTraceButtonStyle} />
        )}
      </Dropdown>
      <CaretDownOutlined className="triangle-icon" style={maybeBothDisabledStyle} />
      {adaptedActiveTool === AnnotationTool.ERASE_BRUSH ||
      adaptedActiveTool === AnnotationTool.ERASE_TRACE ? (
        <MaybeMultiSliceAnnotationInfoIcon />
      ) : null}
    </ToolRadioButton>
  );
}

function FillCellTool({ adaptedActiveTool }: ToolButtonProps) {
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
      value={AnnotationTool.FILL_CELL.id}
    >
      <Icon
        component={FillIcon}
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

function VoxelPipetteTool(_props: ToolButtonProps) {
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  return (
    <ToolRadioButton
      name={AnnotationTool.VOXEL_PIPETTE.readableName}
      description="Inspect a voxel by showing the data values per layer in a tooltip. Clicking on a voxel will pin the tooltip to make the values selectable with the mouse cursor."
      disabledExplanation={disabledInfosForTools[AnnotationTool.VOXEL_PIPETTE.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.VOXEL_PIPETTE.id].isDisabled}
      value={AnnotationTool.VOXEL_PIPETTE.id}
    >
      <Icon
        component={PipetteIcon}
        style={{
          opacity: disabledInfosForTools[AnnotationTool.VOXEL_PIPETTE.id].isDisabled ? 0.5 : 1,
        }}
      />
    </ToolRadioButton>
  );
}

function QuickSelectTool(_props: ToolButtonProps) {
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
      value={AnnotationTool.QUICK_SELECT.id}
    >
      <Icon
        component={QuickSelectToolIcon}
        aria-label="Quick Select Icon"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.QUICK_SELECT.id].isDisabled ? 0.5 : 1,
        }}
      />
    </ToolRadioButton>
  );
}

function BoundingBoxTool(_props: ToolButtonProps) {
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
      value={AnnotationTool.BOUNDING_BOX.id}
    >
      <Icon
        component={BoundingBoxIcon}
        aria-label="Bounding Box Icon"
        style={{
          opacity: disabledInfosForTools[AnnotationTool.BOUNDING_BOX.id].isDisabled ? 0.5 : 1,
        }}
      />
    </ToolRadioButton>
  );
}

function ProofreadTool(_props: ToolButtonProps) {
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
      value={AnnotationTool.PROOFREAD.id}
      onMouseEnter={() => {
        dispatch(ensureLayerMappingsAreLoadedAction());
      }}
      style={NARROW_BUTTON_STYLE}
    >
      <Icon
        component={ProofreadingIcon}
        style={{
          opacity: disabledInfosForTools[AnnotationTool.PROOFREAD.id].isDisabled ? 0.5 : 1,
        }}
      />
    </ToolRadioButton>
  );
}

function MeasurementToolMenu() {
  const measurementPreference = useWkSelector(
    (state) => state.userConfiguration.measurementPreference,
  );
  const favoriteMeasurementTool =
    measurementPreference === "LINE_MEASUREMENT"
      ? AnnotationTool.LINE_MEASUREMENT
      : AnnotationTool.AREA_MEASUREMENT;
  const disabledInfosForTools = useWkSelector(getDisabledInfoForTools);
  const isLineMeasurementDisabled =
    disabledInfosForTools[AnnotationTool.LINE_MEASUREMENT.id].isDisabled;
  const isAreaMeasurementDisabled =
    disabledInfosForTools[AnnotationTool.AREA_MEASUREMENT.id].isDisabled;
  const maybeLineMeasurementButtonStyle = isLineMeasurementDisabled
    ? MAYBE_DISABLED_BUTTON_STYLE
    : {};
  const maybeAreaMeasurementButtonStyle = isAreaMeasurementDisabled
    ? MAYBE_DISABLED_BUTTON_STYLE
    : {};
  const maybeBothDisabledButtonStyle =
    isLineMeasurementDisabled && isAreaMeasurementDisabled ? MAYBE_DISABLED_BUTTON_STYLE : {};
  const dispatch = useDispatch();
  return (
    <ToolRadioButton
      name={favoriteMeasurementTool.readableName}
      disabledExplanation=""
      disabled={false}
      value={favoriteMeasurementTool.id}
      style={NARROW_BUTTON_STYLE}
    >
      <Dropdown
        menu={{
          items: [
            {
              key: AnnotationTool.LINE_MEASUREMENT.id,
              label: "Line Measurement",
              icon: (
                <Icon component={LineMeasurementIcon} style={maybeLineMeasurementButtonStyle} />
              ),
              disabled: isLineMeasurementDisabled,
              title: isLineMeasurementDisabled
                ? disabledInfosForTools[AnnotationTool.LINE_MEASUREMENT.id].explanation
                : "Measure distances with connected lines by using Left Click.",
            },
            {
              key: AnnotationTool.AREA_MEASUREMENT.id,
              label: "Area Measurement",
              icon: (
                <Icon component={AreaMeasurementIcon} style={maybeAreaMeasurementButtonStyle} />
              ),
              disabled: isAreaMeasurementDisabled,
              title: isAreaMeasurementDisabled
                ? disabledInfosForTools[AnnotationTool.AREA_MEASUREMENT.id].explanation
                : "Measure areas by using Left Drag. Avoid self-crossing polygon structure for accurate results.",
            },
          ],
          onClick: (key) => dispatch(setToolAction(AnnotationTool[key.key as AnnotationToolId])),
        }}
        trigger={["hover"]}
      >
        {measurementPreference === "LINE_MEASUREMENT" ? (
          <Icon component={LineMeasurementIcon} style={maybeLineMeasurementButtonStyle} />
        ) : (
          <Icon component={AreaMeasurementIcon} style={maybeAreaMeasurementButtonStyle} />
        )}
      </Dropdown>
      <CaretDownOutlined className="triangle-icon" style={maybeBothDisabledButtonStyle} />
    </ToolRadioButton>
  );
}
