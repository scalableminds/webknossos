import Icon, { CaretDownOutlined } from "@ant-design/icons";
import LayerGroupIcon from "@images/icons/icon-layer-group.svg?react";
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

const getMaybeDisabledButtonStyle = (isDisabled: boolean): React.CSSProperties =>
  isDisabled ? { color: "rgb(255 255 255 / 25%)" } : {};

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
      description={AnnotationTool.MOVE.description}
      disabledExplanation=""
      disabled={false}
      value={AnnotationTool.MOVE.id}
    >
      <Icon component={AnnotationTool.MOVE.icon} />
    </ToolRadioButton>
  );
}

function SkeletonTool(_props: ToolButtonProps) {
  const useLegacyBindings = useWkSelector((state) => state.userConfiguration.useLegacyBindings);
  const skeletonToolDescription = useLegacyBindings
    ? "Use left-click to move around and right-click to create new skeleton nodes"
    : AnnotationTool.SKELETON.description;
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
        component={AnnotationTool.SKELETON.icon}
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
  const currentTool = brushPreference === "BRUSH" ? AnnotationTool.BRUSH : AnnotationTool.TRACE;

  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }

  const isBrushDisabled = disabledInfosForTools[AnnotationTool.BRUSH.id].isDisabled;
  const isTraceDisabled = disabledInfosForTools[AnnotationTool.TRACE.id].isDisabled;

  return (
    <ToolRadioButton
      name={currentTool.readableName}
      disabledExplanation={disabledInfosForTools[currentTool.id].explanation}
      disabled={isBrushDisabled && isTraceDisabled}
      value={currentTool.id}
    >
      <Dropdown
        menu={{
          items: [
            {
              key: AnnotationTool.BRUSH.id,
              label: (
                <FastTooltip
                  title={
                    isBrushDisabled
                      ? disabledInfosForTools[AnnotationTool.BRUSH.id].explanation
                      : "Draw over the voxels you would like to label. Adjust the brush size with Shift + Mousewheel."
                  }
                >
                  Brush
                </FastTooltip>
              ),
              icon: (
                <Icon
                  component={AnnotationTool.BRUSH.icon}
                  style={getMaybeDisabledButtonStyle(isBrushDisabled)}
                />
              ),
              disabled: isBrushDisabled,
            },
            {
              key: AnnotationTool.TRACE.id,
              label: (
                <FastTooltip
                  title={
                    isTraceDisabled
                      ? disabledInfosForTools[AnnotationTool.TRACE.id].explanation
                      : "Draw outlines around the voxels you would like to label."
                  }
                >
                  Trace
                </FastTooltip>
              ),
              icon: (
                <Icon
                  component={AnnotationTool.TRACE.icon}
                  style={getMaybeDisabledButtonStyle(isTraceDisabled)}
                />
              ),
              disabled: isTraceDisabled,
            },
          ],
          onClick: (key) => dispatch(setToolAction(AnnotationTool[key.key as AnnotationToolId])),
        }}
        trigger={["hover"]}
      >
        {brushPreference === "BRUSH" ? (
          <Icon
            component={AnnotationTool.BRUSH.icon}
            style={getMaybeDisabledButtonStyle(isBrushDisabled)}
          />
        ) : (
          <Icon
            component={AnnotationTool.TRACE.icon}
            style={getMaybeDisabledButtonStyle(isTraceDisabled)}
          />
        )}
      </Dropdown>
      <CaretDownOutlined
        className="triangle-icon"
        style={getMaybeDisabledButtonStyle(isBrushDisabled && isTraceDisabled)}
      />
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
  const currentTool =
    erasePreference === "ERASE_BRUSH" ? AnnotationTool.ERASE_BRUSH : AnnotationTool.ERASE_TRACE;

  const isVolumeModificationAllowed = useWkSelector(getIsVolumeModificationAllowed);
  if (!isVolumeModificationAllowed) {
    return null;
  }
  const isEraseBrushDisabled = disabledInfosForTools[AnnotationTool.ERASE_BRUSH.id].isDisabled;
  const isEraseTraceDisabled = disabledInfosForTools[AnnotationTool.ERASE_TRACE.id].isDisabled;
  return (
    <ToolRadioButton
      name={currentTool.readableName}
      disabled={isEraseBrushDisabled && isEraseTraceDisabled}
      disabledExplanation={disabledInfosForTools[currentTool.id].explanation}
      value={currentTool.id}
    >
      <Dropdown
        menu={{
          items: [
            {
              key: AnnotationTool.ERASE_BRUSH.id,
              label: (
                <FastTooltip
                  title={
                    isEraseBrushDisabled
                      ? disabledInfosForTools[AnnotationTool.ERASE_BRUSH.id].explanation
                      : "Erase the voxels by brushing over them. Adjust the brush size with Shift + Mousewheel."
                  }
                >
                  Erase Brush
                </FastTooltip>
              ),
              icon: (
                <Icon
                  component={AnnotationTool.ERASE_BRUSH.icon}
                  style={getMaybeDisabledButtonStyle(isEraseBrushDisabled)}
                />
              ),
              disabled: isEraseBrushDisabled,
            },
            {
              key: AnnotationTool.ERASE_TRACE.id,
              label: (
                <FastTooltip
                  title={
                    isEraseTraceDisabled
                      ? disabledInfosForTools[AnnotationTool.ERASE_TRACE.id].explanation
                      : "Draw outlines around the voxel you would like to erase."
                  }
                >
                  Erase Trace
                </FastTooltip>
              ),
              icon: (
                <Icon
                  component={AnnotationTool.ERASE_TRACE.icon}
                  style={getMaybeDisabledButtonStyle(isEraseTraceDisabled)}
                />
              ),
              disabled: isEraseTraceDisabled,
            },
          ],
          onClick: (key) => dispatch(setToolAction(AnnotationTool[key.key as AnnotationToolId])),
        }}
        trigger={["hover"]}
      >
        {erasePreference === "ERASE_BRUSH" ? (
          <Icon
            component={AnnotationTool.ERASE_BRUSH.icon}
            style={getMaybeDisabledButtonStyle(isEraseBrushDisabled)}
          />
        ) : (
          <Icon
            component={AnnotationTool.ERASE_TRACE.icon}
            style={getMaybeDisabledButtonStyle(isEraseTraceDisabled)}
          />
        )}
      </Dropdown>
      <CaretDownOutlined
        className="triangle-icon"
        style={getMaybeDisabledButtonStyle(isEraseBrushDisabled && isEraseTraceDisabled)}
      />
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
      description={AnnotationTool.FILL_CELL.description}
      disabledExplanation={disabledInfosForTools[AnnotationTool.FILL_CELL.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.FILL_CELL.id].isDisabled}
      value={AnnotationTool.FILL_CELL.id}
    >
      <Icon
        component={AnnotationTool.FILL_CELL.icon}
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
      description={AnnotationTool.VOXEL_PIPETTE.description}
      disabledExplanation={disabledInfosForTools[AnnotationTool.VOXEL_PIPETTE.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.VOXEL_PIPETTE.id].isDisabled}
      value={AnnotationTool.VOXEL_PIPETTE.id}
    >
      <Icon
        component={AnnotationTool.VOXEL_PIPETTE.icon}
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
      description={AnnotationTool.QUICK_SELECT.description}
      disabledExplanation={disabledInfosForTools[AnnotationTool.QUICK_SELECT.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.QUICK_SELECT.id].isDisabled}
      value={AnnotationTool.QUICK_SELECT.id}
    >
      <Icon
        component={AnnotationTool.QUICK_SELECT.icon}
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
      description={AnnotationTool.BOUNDING_BOX.description}
      disabledExplanation={disabledInfosForTools[AnnotationTool.BOUNDING_BOX.id].explanation}
      disabled={disabledInfosForTools[AnnotationTool.BOUNDING_BOX.id].isDisabled}
      value={AnnotationTool.BOUNDING_BOX.id}
    >
      <Icon
        component={AnnotationTool.BOUNDING_BOX.icon}
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
      description={AnnotationTool.PROOFREAD.description}
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
        component={AnnotationTool.PROOFREAD.icon}
        style={{
          opacity: disabledInfosForTools[AnnotationTool.PROOFREAD.id].isDisabled ? 0.5 : 1,
        }}
      />
    </ToolRadioButton>
  );
}

function MeasurementToolMenu({ adaptedActiveTool: _adaptedActiveTool }: ToolButtonProps) {
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
  const dispatch = useDispatch();
  return (
    <ToolRadioButton
      name={favoriteMeasurementTool.readableName}
      disabledExplanation={disabledInfosForTools[favoriteMeasurementTool.id].explanation}
      disabled={isAreaMeasurementDisabled && isLineMeasurementDisabled}
      value={favoriteMeasurementTool.id}
      style={NARROW_BUTTON_STYLE}
    >
      <Dropdown
        menu={{
          items: [
            {
              key: AnnotationTool.LINE_MEASUREMENT.id,
              label: (
                <FastTooltip
                  title={
                    isLineMeasurementDisabled
                      ? disabledInfosForTools[AnnotationTool.LINE_MEASUREMENT.id].explanation
                      : "Measure distances with connected lines by using Left Click."
                  }
                >
                  Line Measurement
                </FastTooltip>
              ),
              icon: (
                <Icon
                  component={AnnotationTool.LINE_MEASUREMENT.icon}
                  style={getMaybeDisabledButtonStyle(isLineMeasurementDisabled)}
                />
              ),
              disabled: isLineMeasurementDisabled,
            },
            {
              key: AnnotationTool.AREA_MEASUREMENT.id,
              label: (
                <FastTooltip
                  title={
                    isAreaMeasurementDisabled
                      ? disabledInfosForTools[AnnotationTool.AREA_MEASUREMENT.id].explanation
                      : "Measure areas by using Left Drag. Avoid self-crossing polygon structure for accurate results."
                  }
                >
                  Area Measurement
                </FastTooltip>
              ),
              icon: (
                <Icon
                  component={AnnotationTool.AREA_MEASUREMENT.icon}
                  style={getMaybeDisabledButtonStyle(isAreaMeasurementDisabled)}
                />
              ),
              disabled: isAreaMeasurementDisabled,
            },
          ],
          onClick: (key) => dispatch(setToolAction(AnnotationTool[key.key as AnnotationToolId])),
        }}
        trigger={["hover"]}
      >
        {measurementPreference === "LINE_MEASUREMENT" ? (
          <Icon
            component={AnnotationTool.LINE_MEASUREMENT.icon}
            style={getMaybeDisabledButtonStyle(isLineMeasurementDisabled)}
          />
        ) : (
          <Icon
            component={AnnotationTool.AREA_MEASUREMENT.icon}
            style={getMaybeDisabledButtonStyle(isAreaMeasurementDisabled)}
          />
        )}
      </Dropdown>
      <CaretDownOutlined
        className="triangle-icon"
        style={getMaybeDisabledButtonStyle(isLineMeasurementDisabled && isAreaMeasurementDisabled)}
      />
    </ToolRadioButton>
  );
}
