import {
  Radio,
  Tooltip,
  Badge,
  Space,
  Popover,
  RadioChangeEvent,
  Dropdown,
  MenuProps,
  Col,
  Row,
  Divider,
} from "antd";
import { ClearOutlined, DownOutlined, ExportOutlined, SettingOutlined } from "@ant-design/icons";
import { useSelector, useDispatch } from "react-redux";
import React, { useEffect, useCallback, useState } from "react";

import { showToastWarningForLargestSegmentIdMissing } from "oxalis/view/largest_segment_id_modal";
import { LogSliderSetting } from "oxalis/view/components/setting_input_views";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import {
  interpolateSegmentationLayerAction,
  createCellAction,
  setMousePositionAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  createTreeAction,
  setMergerModeEnabledAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { document } from "libs/window";
import {
  getActiveSegmentationTracing,
  getMappingInfoForVolumeTracing,
  getMaximumBrushSize,
  getRenderableResolutionForActiveSegmentationTracing,
  getSegmentColorAsHSLA,
  hasAgglomerateMapping,
  hasEditableMapping,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  getDisabledInfoForTools,
  adaptActiveToolToShortcuts,
} from "oxalis/model/accessors/tool_accessor";
import { setToolAction, showQuickSelectSettingsAction } from "oxalis/model/actions/ui_actions";
import { toNullable } from "libs/utils";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { usePrevious, useKeyPress } from "libs/react_hooks";
import { userSettings } from "types/schemas/user_settings.schema";
import ButtonComponent from "oxalis/view/components/button_component";
import { MaterializeVolumeAnnotationModal } from "oxalis/view/action-bar/starting_job_modals";
import {
  ToolsWithOverwriteCapabilities,
  AnnotationToolEnum,
  OverwriteModeEnum,
  FillModeEnum,
  VolumeTools,
  MappingStatusEnum,
  AnnotationTool,
  OverwriteMode,
  ToolsWithInterpolationCapabilities,
  InterpolationModeEnum,
  InterpolationMode,
  Unicode,
  MeasurementTools,
} from "oxalis/constants";
import { Model } from "oxalis/singletons";
import Store, { BrushPresets, OxalisState } from "oxalis/store";

import features from "features";
import { getInterpolationInfo } from "oxalis/model/sagas/volume/volume_interpolation_saga";
import { hslaToCSS } from "oxalis/shaders/utils.glsl";
import { clearProofreadingByProducts } from "oxalis/model/actions/proofread_actions";
import { QuickSelectControls } from "./quick_select_settings";
import { MenuInfo } from "rc-menu/lib/interface";
import { getViewportExtents } from "oxalis/model/accessors/view_mode_accessor";
import { ensureLayerMappingsAreLoadedAction } from "oxalis/model/actions/dataset_actions";
import { APIJobType } from "types/api_flow_types";

const NARROW_BUTTON_STYLE = {
  paddingLeft: 10,
  paddingRight: 8,
};
// The z-index is needed so that the blue border of an active button does override the border color of the neighboring non active button.
const ACTIVE_BUTTON_STYLE = {
  ...NARROW_BUTTON_STYLE,
  borderColor: "var(--ant-color-primary)",
  zIndex: 1,
};
const imgStyleForSpaceyIcons = {
  width: 19,
  height: 19,
  lineHeight: 10,
  marginTop: -2,
  verticalAlign: "middle",
};

function getSkeletonToolHint(
  activeTool: AnnotationTool,
  isShiftPressed: boolean,
  isControlPressed: boolean,
  isAltPressed: boolean,
): string | null | undefined {
  if (activeTool !== AnnotationToolEnum.SKELETON) {
    return null;
  }

  if (!isShiftPressed && !isControlPressed && !isAltPressed) {
    return null;
  }

  if (isShiftPressed && !isControlPressed && !isAltPressed) {
    return "Click to select a node. Right-click to open a contextmenu.";
  }

  if (!isShiftPressed && isControlPressed && !isAltPressed) {
    return "Drag to move the selected node. Right-click to create a new node without selecting it.";
  }

  if (isShiftPressed && !isControlPressed && isAltPressed) {
    return "Click on a node in another tree to merge the two trees.";
  }

  if (isShiftPressed && isControlPressed && !isAltPressed) {
    return "Click on a node to delete the edge to the currently active node.";
  }

  return null;
}

function toggleOverwriteMode(overwriteMode: OverwriteMode) {
  if (overwriteMode === OverwriteModeEnum.OVERWRITE_ALL) {
    return OverwriteModeEnum.OVERWRITE_EMPTY;
  } else {
    return OverwriteModeEnum.OVERWRITE_ALL;
  }
}

const handleUpdateBrushSize = (value: number) => {
  Store.dispatch(updateUserSettingAction("brushSize", value));
};

const handleUpdatePresetBrushSizes = (brushSizes: BrushPresets) => {
  Store.dispatch(updateUserSettingAction("presetBrushSizes", brushSizes));
};

const handleToggleAutomaticMeshRendering = (value: boolean) => {
  Store.dispatch(updateUserSettingAction("autoRenderMeshInProofreading", value));
};

const handleSetTool = (event: RadioChangeEvent) => {
  const value = event.target.value as AnnotationTool;
  Store.dispatch(setToolAction(value));
};

const handleCreateCell = () => {
  const volumeTracing = getActiveSegmentationTracing(Store.getState());

  if (volumeTracing == null || volumeTracing.tracingId == null) {
    return;
  }

  if (volumeTracing.largestSegmentId != null) {
    Store.dispatch(createCellAction(volumeTracing.activeCellId, volumeTracing.largestSegmentId));
  } else {
    showToastWarningForLargestSegmentIdMissing(volumeTracing);
  }
};

const handleAddNewUserBoundingBox = () => {
  Store.dispatch(addUserBoundingBoxAction());
};

const handleSetOverwriteMode = (event: {
  target: {
    value: OverwriteMode;
  };
}) => {
  Store.dispatch(updateUserSettingAction("overwriteMode", event.target.value));
};

function RadioButtonWithTooltip({
  title,
  disabledTitle,
  disabled,
  onClick,
  onOpenChange,
  ...props
}: {
  title: string | React.ReactNode;
  disabledTitle?: string;
  disabled?: boolean;
  children: React.ReactNode;
  style: React.CSSProperties;
  value: string;
  onClick?: (event: React.MouseEvent) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Tooltip title={disabled ? disabledTitle : title} onOpenChange={onOpenChange}>
      <Radio.Button
        disabled={disabled}
        onClick={(event: React.MouseEvent) => {
          if (document.activeElement) {
            (document.activeElement as HTMLElement).blur();
          }
          if (onClick) {
            onClick(event);
          }
        }}
        {...props}
      />
    </Tooltip>
  );
}

function ToolRadioButton({
  name,
  description,
  disabledExplanation,
  onOpenChange,
  ...props
}: {
  name: string;
  description: string;
  disabledExplanation?: string;
  disabled?: boolean;
  children: React.ReactNode;
  style: React.CSSProperties;
  value: string;
  onClick?: (event: React.MouseEvent) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <RadioButtonWithTooltip
      title={`${name} – ${description}`}
      disabledTitle={`${name} – ${disabledExplanation}`}
      onOpenChange={onOpenChange}
      {...props}
    />
  );
}

function OverwriteModeSwitch({
  isControlPressed,
  isShiftPressed,
  visible,
}: {
  isControlPressed: boolean;
  isShiftPressed: boolean;
  visible: boolean;
}) {
  // Only CTRL should modify the overwrite mode. CTRL + Shift can be used to switch to the
  // erase tool, which should not affect the default overwrite mode.
  const overwriteMode = useSelector((state: OxalisState) => state.userConfiguration.overwriteMode);
  const previousIsControlPressed = usePrevious(isControlPressed);
  const previousIsShiftPressed = usePrevious(isShiftPressed);
  // biome-ignore lint/correctness/useExhaustiveDependencies: overwriteMode does not need to be a dependency.
  useEffect(() => {
    // There are four possible states:
    // (1) no modifier is pressed
    // (2) CTRL is pressed
    // (3) Shift is pressed
    // (4) CTRL + Shift is pressed
    // The overwrite mode needs to be toggled when
    // - switching from state (1) to (2) (or vice versa)
    // - switching from state (2) to (4) (or vice versa)
    // Consequently, the mode is only toggled effectively, when CTRL is pressed.
    // Alternatively, we could store the selected value and the overriden value
    // separately in the store. However, this solution works, too.
    const needsModeToggle =
      (!isShiftPressed &&
        isControlPressed &&
        previousIsControlPressed === previousIsShiftPressed) ||
      (isShiftPressed === isControlPressed && !previousIsShiftPressed && previousIsControlPressed);

    if (needsModeToggle) {
      Store.dispatch(updateUserSettingAction("overwriteMode", toggleOverwriteMode(overwriteMode)));
    }
  }, [isControlPressed, isShiftPressed, previousIsControlPressed, previousIsShiftPressed]);

  if (!visible) {
    // This component's hooks should still be active, even when the component is invisible.
    // Otherwise, the toggling of the overwrite mode via "CTRL" wouldn't work consistently
    // when being combined with other modifiers, which hide the component.
    return null;
  }

  return (
    <Radio.Group
      value={overwriteMode}
      // @ts-expect-error ts-migrate(2322) FIXME: Type '(event: {    target: {        value: Overwri... Remove this comment to see the full error message
      onChange={handleSetOverwriteMode}
      style={{
        marginLeft: 10,
      }}
    >
      <RadioButtonWithTooltip
        title="Overwrite everything. This setting can be toggled by holding CTRL."
        style={NARROW_BUTTON_STYLE}
        value={OverwriteModeEnum.OVERWRITE_ALL}
      >
        <img
          src="/assets/images/overwrite-all.svg"
          alt="Overwrite All Icon"
          style={imgStyleForSpaceyIcons}
        />
      </RadioButtonWithTooltip>
      <RadioButtonWithTooltip
        title="Only overwrite empty areas. In case of erasing, only the current segment ID is overwritten. This setting can be toggled by holding CTRL."
        style={NARROW_BUTTON_STYLE}
        value={OverwriteModeEnum.OVERWRITE_EMPTY}
      >
        <img
          src="/assets/images/overwrite-empty.svg"
          alt="Overwrite Empty Icon"
          style={imgStyleForSpaceyIcons}
        />
      </RadioButtonWithTooltip>
    </Radio.Group>
  );
}

const INTERPOLATION_ICON = {
  [InterpolationModeEnum.INTERPOLATE]: <i className="fas fa-align-center fa-rotate-90" />,
  [InterpolationModeEnum.EXTRUDE]: <i className="fas fa-align-justify fa-rotate-90" />,
};
function VolumeInterpolationButton() {
  const dispatch = useDispatch();
  const interpolationMode = useSelector(
    (state: OxalisState) => state.userConfiguration.interpolationMode,
  );

  const onInterpolateClick = (e: React.MouseEvent<HTMLElement> | null) => {
    e?.currentTarget.blur();
    dispatch(interpolateSegmentationLayerAction());
  };

  const { tooltipTitle, isDisabled } = useSelector((state: OxalisState) =>
    getInterpolationInfo(state, "Not available since"),
  );

  const menu: MenuProps = {
    onClick: (e: MenuInfo) => {
      dispatch(updateUserSettingAction("interpolationMode", e.key as InterpolationMode));
      onInterpolateClick(null);
    },
    items: [
      {
        label: "Interpolate current segment",
        key: InterpolationModeEnum.INTERPOLATE,
        icon: INTERPOLATION_ICON[InterpolationModeEnum.INTERPOLATE],
      },
      {
        label: "Extrude (copy) current segment",
        key: InterpolationModeEnum.EXTRUDE,
        icon: INTERPOLATION_ICON[InterpolationModeEnum.EXTRUDE],
      },
    ],
  };

  const buttonsRender = useCallback(
    ([leftButton, rightButton]) => [
      <Tooltip title={tooltipTitle} key="leftButton">
        {React.cloneElement(leftButton as React.ReactElement<any, string>, {
          disabled: isDisabled,
        })}
      </Tooltip>,
      rightButton,
    ],
    [tooltipTitle, isDisabled],
  );

  return (
    // Without the outer div, the Dropdown can eat up all the remaining horizontal space,
    // moving sibling elements to the far right.
    <div>
      <Dropdown.Button
        icon={<DownOutlined />}
        menu={menu}
        onClick={onInterpolateClick}
        style={{ padding: "0 5px 0 6px" }}
        buttonsRender={buttonsRender}
      >
        {React.cloneElement(INTERPOLATION_ICON[interpolationMode], { style: { margin: -4 } })}
      </Dropdown.Button>
    </div>
  );
}

function AdditionalSkeletonModesButtons() {
  const dispatch = useDispatch();
  const isMergerModeEnabled = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const [showMaterializeVolumeAnnotationModal, setShowMaterializeVolumeAnnotationModal] =
    useState<boolean>(false);
  const isNewNodeNewTreeModeOn = useSelector(
    (state: OxalisState) => state.userConfiguration.newNodeNewTree,
  );
  const dataset = useSelector((state: OxalisState) => state.dataset);

  const segmentationTracingLayer = useSelector((state: OxalisState) =>
    getActiveSegmentationTracing(state),
  );
  const isEditableMappingActive =
    segmentationTracingLayer != null && !!segmentationTracingLayer.mappingIsEditable;
  const mergerModeTooltipText = isEditableMappingActive
    ? "Merger mode cannot be enabled while an editable mapping is active."
    : "Toggle Merger Mode - When enabled, skeletons that connect multiple segments will merge those segments.";

  const toggleNewNodeNewTreeMode = () =>
    dispatch(updateUserSettingAction("newNodeNewTree", !isNewNodeNewTreeModeOn));

  const toggleMergerMode = () => dispatch(setMergerModeEnabledAction(!isMergerModeEnabled));

  const newNodeNewTreeModeButtonStyle = isNewNodeNewTreeModeOn
    ? ACTIVE_BUTTON_STYLE
    : NARROW_BUTTON_STYLE;
  const mergerModeButtonStyle = isMergerModeEnabled ? ACTIVE_BUTTON_STYLE : NARROW_BUTTON_STYLE;

  const isMaterializeVolumeAnnotationEnabled =
    dataset.dataStore.jobsSupportedByAvailableWorkers.includes(
      APIJobType.MATERIALIZE_VOLUME_ANNOTATION,
    );

  return (
    <React.Fragment>
      <ButtonComponent
        style={newNodeNewTreeModeButtonStyle}
        onClick={toggleNewNodeNewTreeMode}
        title="Toggle the Single node Tree (soma clicking) mode - If enabled, each node creation will create a new tree."
      >
        <img
          style={imgStyleForSpaceyIcons}
          src="/assets/images/soma-clicking-icon.svg"
          alt="Single Node Tree Mode"
        />
      </ButtonComponent>
      <ButtonComponent
        style={{
          ...mergerModeButtonStyle,
          opacity: isEditableMappingActive ? 0.5 : 1,
        }}
        onClick={toggleMergerMode}
        disabled={isEditableMappingActive}
        title={mergerModeTooltipText}
      >
        <img
          style={imgStyleForSpaceyIcons}
          src="/assets/images/merger-mode-icon.svg"
          alt="Merger Mode"
        />
      </ButtonComponent>
      {isMergerModeEnabled && isMaterializeVolumeAnnotationEnabled && (
        <ButtonComponent
          style={NARROW_BUTTON_STYLE}
          onClick={() => setShowMaterializeVolumeAnnotationModal(true)}
          title="Materialize this merger mode annotation into a new dataset."
        >
          <ExportOutlined />
        </ButtonComponent>
      )}
      {isMaterializeVolumeAnnotationEnabled && showMaterializeVolumeAnnotationModal && (
        <MaterializeVolumeAnnotationModal
          handleClose={() => setShowMaterializeVolumeAnnotationModal(false)}
        />
      )}
    </React.Fragment>
  );
}

const mapId = (volumeTracingId: string | null | undefined, id: number) => {
  if (!volumeTracingId) {
    return null;
  }
  const { cube } = Model.getSegmentationTracingLayer(volumeTracingId);
  return cube.mapId(id);
};

function CreateCellButton() {
  const volumeTracingId = useSelector(
    (state: OxalisState) => getActiveSegmentationTracing(state)?.tracingId,
  );
  const unmappedActiveCellId = useSelector(
    (state: OxalisState) => getActiveSegmentationTracing(state)?.activeCellId || 0,
  );
  const { mappingStatus } = useSelector((state: OxalisState) =>
    getMappingInfoForVolumeTracing(state, volumeTracingId),
  );
  const isMappingEnabled = mappingStatus === MappingStatusEnum.ENABLED;

  const activeCellId = isMappingEnabled
    ? mapId(volumeTracingId, unmappedActiveCellId)
    : unmappedActiveCellId;

  const activeCellColor = useSelector((state: OxalisState) => {
    if (!activeCellId) {
      return null;
    }
    return hslaToCSS(getSegmentColorAsHSLA(state, activeCellId));
  });

  const mappedIdInfo = isMappingEnabled ? ` (currently mapped to ${activeCellId})` : "";
  return (
    <Badge
      dot
      style={{
        boxShadow: "none",
        background: activeCellColor || "transparent",
        zIndex: 1000,
      }}
    >
      <ButtonComponent
        onClick={handleCreateCell}
        style={{
          width: 36,
          paddingLeft: 10,
        }}
        title={`Create a new segment id (C) – The active segment id is ${unmappedActiveCellId}${mappedIdInfo}.`}
      >
        <img src="/assets/images/new-cell.svg" alt="New Segment Icon" />
      </ButtonComponent>
    </Badge>
  );
}

function CreateNewBoundingBoxButton() {
  return (
    <ButtonComponent
      onClick={handleAddNewUserBoundingBox}
      style={{
        paddingLeft: 9,
        paddingRight: 9,
      }}
      title="Create a new bounding box centered around the current position."
    >
      <img
        src="/assets/images/new-bounding-box.svg"
        alt="New Bounding Box Icon"
        style={imgStyleForSpaceyIcons}
      />
    </ButtonComponent>
  );
}

function CreateTreeButton() {
  const dispatch = useDispatch();
  const activeTree = useSelector((state: OxalisState) =>
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'SkeletonTracing | null | undefin... Remove this comment to see the full error message
    toNullable(getActiveTree(state.tracing.skeleton)),
  );
  const rgbColorString =
    activeTree != null
      ? `rgb(${activeTree.color.map((c) => Math.round(c * 255)).join(",")})`
      : "transparent";
  const activeTreeHint =
    activeTree != null
      ? `The active tree id is ${activeTree.treeId}.`
      : "No tree is currently selected";

  const handleCreateTree = () => dispatch(createTreeAction());

  return (
    <Badge
      dot
      style={{
        boxShadow: "none",
        background: rgbColorString,
        zIndex: 1000,
      }}
    >
      <ButtonComponent
        onClick={handleCreateTree}
        style={{ ...NARROW_BUTTON_STYLE, paddingRight: 5 }}
        title={`Create a new Tree (C) – ${activeTreeHint}`}
      >
        <i
          style={{
            opacity: 0.9,
            transform: "scale(0.9) translate(-2px, -1px)",
            marginRight: 3,
          }}
          className="fas fa-project-diagram"
        />
        <i
          className="fas fa-plus"
          style={{
            position: "absolute",
            top: 13,
            left: 21,
            fontSize: 11,
          }}
        />
      </ButtonComponent>
    </Badge>
  );
}

function BrushPresetButton({
  name,
  icon,
  brushSize,
  onClick,
}: {
  name: string;
  onClick: () => void;
  icon: JSX.Element;
  brushSize: number;
}) {
  const { ThinSpace } = Unicode;
  return (
    <>
      <div style={{ textAlign: "center" }}>
        <ButtonComponent onClick={onClick}>{icon}</ButtonComponent>
      </div>
      <div style={{ textAlign: "center" }}>{name}</div>
      <div style={{ lineHeight: "50%", opacity: 0.6, textAlign: "center", fontSize: 12 }}>
        {brushSize}
        {ThinSpace}vx
      </div>
    </>
  );
}

export function getDefaultBrushSizes(maximumSize: number, minimumSize: number) {
  return {
    small: Math.max(minimumSize, 10),
    medium: calculateMediumBrushSize(maximumSize),
    large: maximumSize,
  };
}

function ChangeBrushSizePopover() {
  const dispatch = useDispatch();
  const brushSize = useSelector((state: OxalisState) => state.userConfiguration.brushSize);
  const [isBrushSizePopoverOpen, setIsBrushSizePopoverOpen] = useState(false);
  const maximumBrushSize = useSelector((state: OxalisState) => getMaximumBrushSize(state));

  const defaultBrushSizes = getDefaultBrushSizes(maximumBrushSize, userSettings.brushSize.minimum);
  const presetBrushSizes = useSelector(
    (state: OxalisState) => state.userConfiguration.presetBrushSizes,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Needs investigation whether defaultBrushSizes is needed as dependency.
  useEffect(() => {
    if (presetBrushSizes == null) {
      handleUpdatePresetBrushSizes(defaultBrushSizes);
    }
  }, [presetBrushSizes]);

  let smallBrushSize: number, mediumBrushSize: number, largeBrushSize: number;
  if (presetBrushSizes == null) {
    smallBrushSize = defaultBrushSizes.small;
    mediumBrushSize = defaultBrushSizes.medium;
    largeBrushSize = defaultBrushSizes.large;
  } else {
    smallBrushSize = presetBrushSizes?.small;
    mediumBrushSize = presetBrushSizes?.medium;
    largeBrushSize = presetBrushSizes?.large;
  }

  const centerBrushInViewport = () => {
    const position = getViewportExtents(Store.getState());
    const activeViewPort = Store.getState().viewModeData.plane.activeViewport;
    dispatch(
      setMousePositionAction([position[activeViewPort][0] / 2, position[activeViewPort][1] / 2]),
    );
  };

  const items: MenuProps["items"] = [
    {
      label: "Assign current brush size to",
      key: "assignToParent",
      children: [
        {
          label: (
            <div
              onClick={() =>
                handleUpdatePresetBrushSizes({
                  small: brushSize,
                  medium: mediumBrushSize,
                  large: largeBrushSize,
                })
              }
            >
              Small brush
            </div>
          ),
          key: "assignToSmall",
        },
        {
          label: (
            <div
              onClick={() =>
                handleUpdatePresetBrushSizes({
                  small: smallBrushSize,
                  medium: brushSize,
                  large: maximumBrushSize,
                })
              }
            >
              Medium brush
            </div>
          ),
          key: "assignToMedium",
        },
        {
          label: (
            <div
              onClick={() =>
                handleUpdatePresetBrushSizes({
                  small: smallBrushSize,
                  medium: mediumBrushSize,
                  large: brushSize,
                })
              }
            >
              Large brush
            </div>
          ),
          key: "assignToLarge",
        },
      ],
    },
    {
      label: <div onClick={() => handleUpdatePresetBrushSizes(defaultBrushSizes)}>Reset</div>,
      key: "reset",
    },
  ];

  return (
    <Tooltip title="Change the brush size">
      <Popover
        title="Brush Size"
        content={
          <div
            style={{
              width: 230,
            }}
            onMouseEnter={() => centerBrushInViewport()}
          >
            <Row align="middle" style={{ textAlign: "center" }}>
              <Col>
                <LogSliderSetting
                  label=""
                  roundTo={0}
                  min={userSettings.brushSize.minimum}
                  max={maximumBrushSize}
                  precision={0}
                  spans={[0, 18, 6]}
                  value={brushSize}
                  onChange={handleUpdateBrushSize}
                />
              </Col>
              <Col>
                <Dropdown
                  menu={{ items }}
                  trigger={["click", "contextMenu", "hover"]}
                  placement="bottomLeft"
                >
                  <SettingOutlined />
                </Dropdown>
              </Col>
            </Row>
            <Divider style={{ marginBottom: 15, marginTop: 15 }} />
            <Row justify="space-between" align="middle">
              <Col>
                <BrushPresetButton
                  name="Small"
                  onClick={() => handleUpdateBrushSize(smallBrushSize)}
                  icon={<i className="fas fa-circle fa-xs" style={{ transform: "scale(0.6)" }} />}
                  brushSize={Math.round(smallBrushSize)}
                />
              </Col>
              <Col>
                <BrushPresetButton
                  name="Medium"
                  onClick={() => handleUpdateBrushSize(mediumBrushSize)}
                  icon={<i className="fas fa-circle fa-sm" />}
                  brushSize={Math.round(mediumBrushSize)}
                />
              </Col>
              <Col>
                <BrushPresetButton
                  name="Large"
                  onClick={() => handleUpdateBrushSize(largeBrushSize)}
                  icon={<i className="fas fa-circle fa-lg" />}
                  brushSize={Math.round(largeBrushSize)}
                />
              </Col>
            </Row>
          </div>
        }
        trigger="click"
        open={isBrushSizePopoverOpen}
        placement="bottom"
        style={{
          cursor: "pointer",
        }}
        onOpenChange={(open: boolean) => {
          setIsBrushSizePopoverOpen(open);
          if (open) centerBrushInViewport();
          else dispatch(setMousePositionAction(null));
        }}
      >
        <ButtonComponent
          style={{
            width: 36,
            padding: 0,
          }}
        >
          <img
            src="/assets/images/brush-size-icon.svg"
            alt="Brush Size"
            style={{
              width: 20,
              height: 20,
            }}
          />
        </ButtonComponent>
      </Popover>
    </Tooltip>
  );
}

function calculateMediumBrushSize(maximumBrushSize: number) {
  return Math.ceil((maximumBrushSize - userSettings.brushSize.minimum) / 10) * 5;
}

const TOOL_NAMES = {
  MOVE: "Move",
  SKELETON: "Skeleton",
  BRUSH: "Brush",
  ERASE_BRUSH: "Erase (via Brush)",
  TRACE: "Trace",
  ERASE_TRACE: "Erase",
  FILL_CELL: "Fill Tool",
  PICK_CELL: "Segment Picker",
  QUICK_SELECT: "Quick Select Tool",
  BOUNDING_BOX: "Bounding Box Tool",
  PROOFREAD: "Proofreading Tool",
  LINE_MEASUREMENT: "Measurement Tool",
  AREA_MEASUREMENT: "Area Measurement Tool",
};

export default function ToolbarView() {
  const dispatch = useDispatch();
  const hasVolume = useSelector((state: OxalisState) => state.tracing.volumes.length > 0);
  const hasSkeleton = useSelector((state: OxalisState) => state.tracing.skeleton != null);
  const isAgglomerateMappingEnabled = useSelector(hasAgglomerateMapping);

  const [lastForcefulDisabledTool, setLastForcefulDisabledTool] = useState<AnnotationTool | null>(
    null,
  );
  const isVolumeModificationAllowed = useSelector(
    (state: OxalisState) => !hasEditableMapping(state),
  );
  const useLegacyBindings = useSelector(
    (state: OxalisState) => state.userConfiguration.useLegacyBindings,
  );
  const activeTool = useSelector((state: OxalisState) => state.uiInformation.activeTool);
  const maybeResolutionWithZoomStep = useSelector(
    getRenderableResolutionForActiveSegmentationTracing,
  );

  const labeledResolution =
    maybeResolutionWithZoomStep != null ? maybeResolutionWithZoomStep.resolution : null;
  const hasResolutionWithHigherDimension = (labeledResolution || []).some((val) => val > 1);
  const multiSliceAnnotationInfoIcon = hasResolutionWithHigherDimension ? (
    <Tooltip title="You are annotating in a low resolution. Depending on the used viewport, you might be annotating multiple slices at once.">
      <i
        className="fas fa-layer-group"
        style={{
          marginLeft: 4,
        }}
      />
    </Tooltip>
  ) : null;

  const disabledInfosForTools = useSelector(getDisabledInfoForTools);
  // Ensure that no volume-tool is selected when being in merger mode.
  // Even though the volume toolbar is disabled, the user can still cycle through
  // the tools via the w shortcut. In that case, the effect-hook is re-executed
  // and the tool is switched to MOVE.
  const disabledInfoForCurrentTool = disabledInfosForTools[activeTool];

  // biome-ignore lint/correctness/useExhaustiveDependencies: Adding disabledInfosForTools[lastForcefulDisabledTool].isDisabled as dependency requires another null-check which makes the dependency itself quite tedious.
  useEffect(() => {
    if (disabledInfoForCurrentTool.isDisabled) {
      setLastForcefulDisabledTool(activeTool);
      Store.dispatch(setToolAction(AnnotationToolEnum.MOVE));
    } else if (
      lastForcefulDisabledTool != null &&
      !disabledInfosForTools[lastForcefulDisabledTool].isDisabled &&
      activeTool === AnnotationToolEnum.MOVE
    ) {
      // Reenable the tool that was disabled before.
      setLastForcefulDisabledTool(null);
      Store.dispatch(setToolAction(lastForcefulDisabledTool));
    } else if (activeTool !== AnnotationToolEnum.MOVE) {
      // Forget the last disabled tool as another tool besides the move tool was selected.
      setLastForcefulDisabledTool(null);
    }
  }, [activeTool, disabledInfoForCurrentTool, lastForcefulDisabledTool]);

  const isShiftPressed = useKeyPress("Shift");
  const isControlPressed = useKeyPress("Control");
  const isAltPressed = useKeyPress("Alt");
  const adaptedActiveTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlPressed,
    isAltPressed,
  );
  const skeletonToolHint =
    hasSkeleton && useLegacyBindings
      ? getSkeletonToolHint(activeTool, isShiftPressed, isControlPressed, isAltPressed)
      : null;
  const previousSkeletonToolHint = usePrevious(skeletonToolHint);

  const skeletonToolDescription = useLegacyBindings
    ? "Use left-click to move around and right-click to create new skeleton nodes"
    : "Use left-click to move around or to create/select/move nodes. Right-click opens a context menu with further options.";
  const showEraseTraceTool =
    adaptedActiveTool === AnnotationToolEnum.TRACE ||
    adaptedActiveTool === AnnotationToolEnum.ERASE_TRACE;
  const showEraseBrushTool = !showEraseTraceTool;

  return (
    <>
      <Radio.Group onChange={handleSetTool} value={adaptedActiveTool}>
        <ToolRadioButton
          name={TOOL_NAMES.MOVE}
          description="Use left-click to move around and right-click to open a contextmenu."
          disabledExplanation=""
          disabled={false}
          style={NARROW_BUTTON_STYLE}
          value={AnnotationToolEnum.MOVE}
        >
          <i className="fas fa-arrows-alt" />
        </ToolRadioButton>

        {hasSkeleton ? (
          <ToolRadioButton
            name={TOOL_NAMES.SKELETON}
            description={skeletonToolDescription}
            disabledExplanation={disabledInfosForTools[AnnotationToolEnum.SKELETON].explanation}
            disabled={disabledInfosForTools[AnnotationToolEnum.SKELETON].isDisabled}
            style={NARROW_BUTTON_STYLE}
            value={AnnotationToolEnum.SKELETON}
          >
            {/*
           When visible changes to false, the tooltip fades out in an animation. However, skeletonToolHint
           will be null, too, which means the tooltip text would immediately change to an empty string.
           To avoid this, we fallback to previousSkeletonToolHint.
          */}
            <Tooltip
              title={skeletonToolHint || previousSkeletonToolHint}
              open={skeletonToolHint != null}
            >
              <i
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.SKELETON].isDisabled ? 0.5 : 1,
                }}
                className="fas fa-project-diagram"
              />
            </Tooltip>
          </ToolRadioButton>
        ) : null}

        {hasVolume && isVolumeModificationAllowed ? (
          <React.Fragment>
            <ToolRadioButton
              name={TOOL_NAMES.BRUSH}
              description={
                "Draw over the voxels you would like to label. Adjust the brush size with Shift + Mousewheel."
              }
              disabledExplanation={disabledInfosForTools[AnnotationToolEnum.BRUSH].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.BRUSH].isDisabled}
              style={NARROW_BUTTON_STYLE}
              value={AnnotationToolEnum.BRUSH}
            >
              <i
                className="fas fa-paint-brush"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.BRUSH].isDisabled ? 0.5 : 1,
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.BRUSH ? multiSliceAnnotationInfoIcon : null}
            </ToolRadioButton>

            <ToolRadioButton
              name={TOOL_NAMES.ERASE_BRUSH}
              description="Erase the voxels by brushing over them. Adjust the brush size with Shift + Mousewheel."
              disabledExplanation={
                disabledInfosForTools[AnnotationToolEnum.ERASE_BRUSH].explanation
              }
              disabled={disabledInfosForTools[AnnotationToolEnum.ERASE_BRUSH].isDisabled}
              style={{
                ...NARROW_BUTTON_STYLE,
                marginLeft: showEraseBrushTool ? 0 : -38,
                zIndex: showEraseBrushTool ? "initial" : -10,
                transition: "margin 0.3s",
              }}
              value={AnnotationToolEnum.ERASE_BRUSH}
            >
              <i
                className="fas fa-eraser"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.ERASE_BRUSH].isDisabled
                    ? 0.5
                    : 1,
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.ERASE_BRUSH
                ? multiSliceAnnotationInfoIcon
                : null}
            </ToolRadioButton>

            <ToolRadioButton
              name={TOOL_NAMES.TRACE}
              description="Draw outlines around the voxels you would like to label."
              disabledExplanation={disabledInfosForTools[AnnotationToolEnum.TRACE].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.TRACE].isDisabled}
              style={NARROW_BUTTON_STYLE}
              value={AnnotationToolEnum.TRACE}
            >
              <img
                src="/assets/images/lasso.svg"
                alt="Trace Tool Icon"
                style={{
                  marginRight: 4,
                  opacity: disabledInfosForTools[AnnotationToolEnum.TRACE].isDisabled ? 0.5 : 1,
                  ...imgStyleForSpaceyIcons,
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.TRACE ? multiSliceAnnotationInfoIcon : null}
            </ToolRadioButton>

            <ToolRadioButton
              name={TOOL_NAMES.ERASE_TRACE}
              description="Draw outlines around the voxel you would like to erase."
              disabledExplanation={
                disabledInfosForTools[AnnotationToolEnum.ERASE_TRACE].explanation
              }
              disabled={disabledInfosForTools[AnnotationToolEnum.ERASE_TRACE].isDisabled}
              style={{
                ...NARROW_BUTTON_STYLE,
                marginLeft: showEraseTraceTool ? 0 : -38,
                zIndex: showEraseTraceTool ? "initial" : -10,
                transition: "margin 0.3s",
              }}
              value={AnnotationToolEnum.ERASE_TRACE}
            >
              <i
                className="fas fa-eraser"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.ERASE_TRACE].isDisabled
                    ? 0.5
                    : 1,
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.ERASE_TRACE
                ? multiSliceAnnotationInfoIcon
                : null}
            </ToolRadioButton>

            <ToolRadioButton
              name={TOOL_NAMES.FILL_CELL}
              description="Flood-fill the clicked region."
              disabledExplanation={disabledInfosForTools[AnnotationToolEnum.FILL_CELL].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.FILL_CELL].isDisabled}
              style={NARROW_BUTTON_STYLE}
              value={AnnotationToolEnum.FILL_CELL}
            >
              <i
                className="fas fa-fill-drip"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.FILL_CELL].isDisabled ? 0.5 : 1,
                  transform: "scaleX(-1)",
                }}
              />
              {adaptedActiveTool === AnnotationToolEnum.FILL_CELL
                ? multiSliceAnnotationInfoIcon
                : null}
            </ToolRadioButton>
            <ToolRadioButton
              name={TOOL_NAMES.PICK_CELL}
              description="Click on a voxel to make its segment id the active segment id."
              disabledExplanation={disabledInfosForTools[AnnotationToolEnum.PICK_CELL].explanation}
              disabled={disabledInfosForTools[AnnotationToolEnum.PICK_CELL].isDisabled}
              style={NARROW_BUTTON_STYLE}
              value={AnnotationToolEnum.PICK_CELL}
            >
              <i
                className="fas fa-eye-dropper"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.PICK_CELL].isDisabled ? 0.5 : 1,
                }}
              />
            </ToolRadioButton>
          </React.Fragment>
        ) : null}
        <ToolRadioButton
          name={TOOL_NAMES.QUICK_SELECT}
          description="Draw a rectangle around a segment to automatically detect it"
          disabledExplanation={disabledInfosForTools[AnnotationToolEnum.QUICK_SELECT].explanation}
          disabled={disabledInfosForTools[AnnotationToolEnum.QUICK_SELECT].isDisabled}
          style={NARROW_BUTTON_STYLE}
          value={AnnotationToolEnum.QUICK_SELECT}
        >
          <img
            src="/assets/images/quick-select-tool.svg"
            alt="Quick Select Icon"
            style={{
              opacity: disabledInfosForTools[AnnotationToolEnum.QUICK_SELECT].isDisabled ? 0.5 : 1,
              ...imgStyleForSpaceyIcons,
            }}
          />
        </ToolRadioButton>
        <ToolRadioButton
          name={TOOL_NAMES.BOUNDING_BOX}
          description="Create, resize and modify bounding boxes."
          disabledExplanation={disabledInfosForTools[AnnotationToolEnum.BOUNDING_BOX].explanation}
          disabled={disabledInfosForTools[AnnotationToolEnum.BOUNDING_BOX].isDisabled}
          style={NARROW_BUTTON_STYLE}
          value={AnnotationToolEnum.BOUNDING_BOX}
        >
          <img
            src="/assets/images/bounding-box.svg"
            alt="Bounding Box Icon"
            style={{
              opacity: disabledInfosForTools[AnnotationToolEnum.BOUNDING_BOX].isDisabled ? 0.5 : 1,
              ...imgStyleForSpaceyIcons,
            }}
          />
        </ToolRadioButton>

        {hasSkeleton && hasVolume ? (
          <ToolRadioButton
            name={TOOL_NAMES.PROOFREAD}
            description="Modify an agglomerated segmentation. Other segmentation modifications, like brushing, are not allowed if this tool is used."
            disabledExplanation={
              isAgglomerateMappingEnabled.reason ||
              disabledInfosForTools[AnnotationToolEnum.PROOFREAD].explanation
            }
            disabled={
              !isAgglomerateMappingEnabled.value ||
              disabledInfosForTools[AnnotationToolEnum.PROOFREAD].isDisabled
            }
            style={NARROW_BUTTON_STYLE}
            value={AnnotationToolEnum.PROOFREAD}
            onOpenChange={(open: boolean) => {
              if (open) {
                dispatch(ensureLayerMappingsAreLoadedAction());
              }
            }}
          >
            <i
              className="fas fa-clipboard-check"
              style={{
                opacity: disabledInfosForTools[AnnotationToolEnum.PROOFREAD].isDisabled ? 0.5 : 1,
              }}
            />
          </ToolRadioButton>
        ) : null}
        <ToolRadioButton
          name={TOOL_NAMES.LINE_MEASUREMENT}
          description="Use to measure distances or areas."
          disabledExplanation=""
          disabled={false}
          style={NARROW_BUTTON_STYLE}
          value={AnnotationToolEnum.LINE_MEASUREMENT}
        >
          <i className="fas fa-ruler" />
        </ToolRadioButton>
      </Radio.Group>

      <ToolSpecificSettings
        hasSkeleton={hasSkeleton}
        adaptedActiveTool={adaptedActiveTool}
        hasVolume={hasVolume}
        isControlPressed={isControlPressed}
        isShiftPressed={isShiftPressed}
      />
    </>
  );
}

function ToolSpecificSettings({
  hasSkeleton,
  adaptedActiveTool,
  hasVolume,
  isControlPressed,
  isShiftPressed,
}: {
  hasSkeleton: boolean;
  adaptedActiveTool: AnnotationTool;
  hasVolume: boolean;
  isControlPressed: boolean;
  isShiftPressed: boolean;
}) {
  const showCreateTreeButton = hasSkeleton && adaptedActiveTool === AnnotationToolEnum.SKELETON;
  const showNewBoundingBoxButton = adaptedActiveTool === AnnotationToolEnum.BOUNDING_BOX;
  const showCreateCellButton = hasVolume && VolumeTools.includes(adaptedActiveTool);
  const showChangeBrushSizeButton =
    showCreateCellButton &&
    (adaptedActiveTool === AnnotationToolEnum.BRUSH ||
      adaptedActiveTool === AnnotationToolEnum.ERASE_BRUSH);
  const dispatch = useDispatch();
  const quickSelectConfig = useSelector(
    (state: OxalisState) => state.userConfiguration.quickSelect,
  );
  const isAISelectAvailable = features().segmentAnythingEnabled;
  const isQuickSelectHeuristic = quickSelectConfig.useHeuristic || !isAISelectAvailable;
  const heuristicButtonStyle = isQuickSelectHeuristic ? NARROW_BUTTON_STYLE : ACTIVE_BUTTON_STYLE;
  const quickSelectTooltipText = isAISelectAvailable
    ? isQuickSelectHeuristic
      ? "The quick select tool is now working without AI. Activate AI for better results."
      : "The quick select tool is now working with AI."
    : "The quick select tool with AI is only available on webknossos.org";
  const toggleQuickSelectStrategy = () => {
    dispatch(
      updateUserSettingAction("quickSelect", {
        ...quickSelectConfig,
        useHeuristic: !quickSelectConfig.useHeuristic,
      }),
    );
  };

  return (
    <>
      {showCreateTreeButton ? (
        <Space.Compact
          style={{
            marginLeft: 10,
          }}
        >
          <CreateTreeButton />
          <AdditionalSkeletonModesButtons />
        </Space.Compact>
      ) : null}

      {showNewBoundingBoxButton ? (
        <Space.Compact
          style={{
            marginLeft: 10,
          }}
        >
          <CreateNewBoundingBoxButton />
        </Space.Compact>
      ) : null}

      {showCreateCellButton || showChangeBrushSizeButton ? (
        <Space.Compact
          style={{
            marginLeft: 12,
          }}
        >
          {showCreateCellButton ? <CreateCellButton /> : null}
          {showChangeBrushSizeButton ? <ChangeBrushSizePopover /> : null}
        </Space.Compact>
      ) : null}

      <OverwriteModeSwitch
        isControlPressed={isControlPressed}
        isShiftPressed={isShiftPressed}
        visible={ToolsWithOverwriteCapabilities.includes(adaptedActiveTool)}
      />

      {adaptedActiveTool === "QUICK_SELECT" && (
        <>
          <ButtonComponent
            style={{
              ...heuristicButtonStyle,
              opacity: isQuickSelectHeuristic ? 0.5 : 1,
              marginLeft: 12,
            }}
            onClick={toggleQuickSelectStrategy}
            disabled={!isAISelectAvailable}
            title={quickSelectTooltipText}
          >
            <i className="fas fa-magic icon-margin-right" /> AI
          </ButtonComponent>

          {isQuickSelectHeuristic && <QuickSelectSettingsPopover />}
        </>
      )}

      {ToolsWithInterpolationCapabilities.includes(adaptedActiveTool) ? (
        <VolumeInterpolationButton />
      ) : null}

      {adaptedActiveTool === AnnotationToolEnum.FILL_CELL ? <FillModeSwitch /> : null}

      {adaptedActiveTool === AnnotationToolEnum.PROOFREAD ? <ProofReadingComponents /> : null}

      {MeasurementTools.includes(adaptedActiveTool) ? (
        <MeasurementToolSwitch activeTool={adaptedActiveTool} />
      ) : null}
    </>
  );
}

function QuickSelectSettingsPopover() {
  const dispatch = useDispatch();
  const { quickSelectState, areQuickSelectSettingsOpen } = useSelector(
    (state: OxalisState) => state.uiInformation,
  );
  const isQuickSelectActive = quickSelectState === "active";
  return (
    <Popover
      trigger="click"
      placement="bottom"
      open={areQuickSelectSettingsOpen}
      content={<QuickSelectControls />}
      onOpenChange={(open: boolean) => {
        dispatch(showQuickSelectSettingsAction(open));
      }}
    >
      <ButtonComponent
        title="Configure Quick Select"
        tooltipPlacement="right"
        className="narrow"
        type={isQuickSelectActive ? "primary" : "default"}
        style={{ marginLeft: 12, marginRight: 12 }}
      >
        <SettingOutlined />
      </ButtonComponent>
    </Popover>
  );
}

const handleSetFillMode = (event: RadioChangeEvent) => {
  Store.dispatch(updateUserSettingAction("fillMode", event.target.value));
};

function FillModeSwitch() {
  const fillMode = useSelector((state: OxalisState) => state.userConfiguration.fillMode);
  return (
    <Radio.Group
      value={fillMode}
      onChange={handleSetFillMode}
      style={{
        marginLeft: 10,
      }}
    >
      <RadioButtonWithTooltip
        title="Only perform the Fill operation in the current plane."
        style={NARROW_BUTTON_STYLE}
        value={FillModeEnum._2D}
      >
        2D
      </RadioButtonWithTooltip>
      <RadioButtonWithTooltip
        title="Perform the Fill operation in 3D."
        style={NARROW_BUTTON_STYLE}
        value={FillModeEnum._3D}
      >
        3D
      </RadioButtonWithTooltip>
    </Radio.Group>
  );
}

function ProofReadingComponents() {
  const dispatch = useDispatch();
  const handleClearProofreading = () => dispatch(clearProofreadingByProducts());
  const autoRenderMeshes = useSelector(
    (state: OxalisState) => state.userConfiguration.autoRenderMeshInProofreading,
  );
  const buttonStyle = autoRenderMeshes ? ACTIVE_BUTTON_STYLE : NARROW_BUTTON_STYLE;
  return (
    <>
      <ButtonComponent
        title="Clear auxiliary meshes that were loaded while proofreading segments. Use this if you are done with correcting mergers or splits in a segment pair."
        onClick={handleClearProofreading}
        className="narrow"
        style={{ marginLeft: 12 }}
      >
        <ClearOutlined />
      </ButtonComponent>
      <ButtonComponent
        title={`${autoRenderMeshes ? "Disable" : "Enable"} automatic loading of meshes`}
        style={{ ...buttonStyle, opacity: autoRenderMeshes ? 1 : 0.5 }}
        onClick={() => handleToggleAutomaticMeshRendering(!autoRenderMeshes)}
      >
        <i className="fas fa-dice-d20" />
      </ButtonComponent>
    </>
  );
}

function MeasurementToolSwitch({ activeTool }: { activeTool: AnnotationTool }) {
  const dispatch = useDispatch();

  const handleSetMeasurementTool = (evt: RadioChangeEvent) => {
    dispatch(setToolAction(evt.target.value));
  };
  return (
    <Radio.Group
      value={activeTool}
      onChange={handleSetMeasurementTool}
      style={{
        marginLeft: 10,
      }}
    >
      <RadioButtonWithTooltip
        title="Measure distances with connected lines by using Left Click."
        style={NARROW_BUTTON_STYLE}
        value={AnnotationToolEnum.LINE_MEASUREMENT}
      >
        <img src="/assets/images/line-measurement.svg" alt="Measurement Tool Icon" />
      </RadioButtonWithTooltip>
      <RadioButtonWithTooltip
        title={
          <>
            Measure areas by using Left Drag.
            <br />
            Avoid self-crossing polygon structure for accurate results.
          </>
        }
        style={NARROW_BUTTON_STYLE}
        value={AnnotationToolEnum.AREA_MEASUREMENT}
      >
        <img
          src="/assets/images/area-measurement.svg"
          alt="Measurement Tool Icon"
          style={imgStyleForSpaceyIcons}
        />
      </RadioButtonWithTooltip>
    </Radio.Group>
  );
}
