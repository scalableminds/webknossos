import {
  ClearOutlined,
  DownOutlined,
  ExportOutlined,
  InfoCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  Badge,
  Col,
  Divider,
  Dropdown,
  type MenuProps,
  Popconfirm,
  Popover,
  Radio,
  type RadioChangeEvent,
  Row,
  Space,
} from "antd";
import React, { useEffect, useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { useKeyPress, usePrevious } from "libs/react_hooks";
import { document } from "libs/window";
import {
  type AnnotationTool,
  AnnotationToolEnum,
  FillModeEnum,
  type InterpolationMode,
  InterpolationModeEnum,
  MappingStatusEnum,
  MeasurementTools,
  type OverwriteMode,
  OverwriteModeEnum,
  ToolsWithInterpolationCapabilities,
  ToolsWithOverwriteCapabilities,
  Unicode,
  VolumeTools,
} from "oxalis/constants";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  adaptActiveToolToShortcuts,
  getDisabledInfoForTools,
} from "oxalis/model/accessors/tool_accessor";
import {
  getActiveSegmentationTracing,
  getMappingInfoForVolumeTracing,
  getMaximumBrushSize,
  getRenderableMagForActiveSegmentationTracing,
  getSegmentColorAsRGBA,
  hasAgglomerateMapping,
  hasEditableMapping,
} from "oxalis/model/accessors/volumetracing_accessor";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import {
  createTreeAction,
  setMergerModeEnabledAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setToolAction, showQuickSelectSettingsAction } from "oxalis/model/actions/ui_actions";
import {
  createCellAction,
  interpolateSegmentationLayerAction,
  setMousePositionAction,
} from "oxalis/model/actions/volumetracing_actions";
import { Model } from "oxalis/singletons";
import Store, { type BrushPresets, type OxalisState } from "oxalis/store";
import { MaterializeVolumeAnnotationModal } from "oxalis/view/action-bar/starting_job_modals";
import ButtonComponent from "oxalis/view/components/button_component";
import { LogSliderSetting } from "oxalis/view/components/setting_input_views";
import { showToastWarningForLargestSegmentIdMissing } from "oxalis/view/largest_segment_id_modal";
import { userSettings } from "types/schemas/user_settings.schema";

import { updateNovelUserExperienceInfos } from "admin/admin_rest_api";
import FastTooltip from "components/fast_tooltip";
import features from "features";
import { useIsActiveUserAdminOrManager } from "libs/react_helpers";
import defaultState from "oxalis/default_state";
import { getViewportExtents } from "oxalis/model/accessors/view_mode_accessor";
import { ensureLayerMappingsAreLoadedAction } from "oxalis/model/actions/dataset_actions";
import { clearProofreadingByProducts } from "oxalis/model/actions/proofread_actions";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { getInterpolationInfo } from "oxalis/model/sagas/volume/volume_interpolation_saga";
import { rgbaToCSS } from "oxalis/shaders/utils.glsl";
import type { MenuInfo } from "rc-menu/lib/interface";
import { APIJobType } from "types/api_flow_types";
import { QuickSelectControls } from "./quick_select_settings";

const NARROW_BUTTON_STYLE = {
  paddingLeft: 10,
  paddingRight: 8,
};
const imgStyleForSpaceyIcons = {
  width: 19,
  height: 19,
  lineHeight: 10,
  marginTop: -2,
  verticalAlign: "middle",
};

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

const handleToggleSelectiveVisibilityInProofreading = (value: boolean) => {
  Store.dispatch(updateUserSettingAction("selectiveVisibilityInProofreading", value));
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
  children,
  onMouseEnter,
  ...props
}: {
  title: string;
  disabledTitle?: string;
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  value: string;
  onClick?: (event: React.MouseEvent) => void;
  onMouseEnter?: () => void;
}) {
  // FastTooltip adds data-* properties so that the centralized ReactTooltip
  // is hooked up here. Unfortunately, FastTooltip would add another div or span
  // which antd does not like within this toolbar.
  // Therefore, we move the tooltip into the button which requires tweaking the padding
  // a bit (otherwise, the tooltip would only occur when hovering exactly over the icon
  // instead of everywhere within the button).
  return (
    <Radio.Button
      disabled={disabled}
      // Remove the padding here and add it within the tooltip.
      className="no-padding"
      onClick={(event: React.MouseEvent) => {
        if (document.activeElement) {
          (document.activeElement as HTMLElement).blur();
        }
        if (onClick) {
          onClick(event);
        }
      }}
      {...props}
    >
      <FastTooltip title={disabled ? disabledTitle : title} onMouseEnter={onMouseEnter}>
        {/* See comments above. */}
        <span style={{ padding: "0 10px", display: "block" }}>{children}</span>
      </FastTooltip>
    </Radio.Button>
  );
}

function ToolRadioButton({
  name,
  description,
  disabledExplanation,
  onMouseEnter,
  ...props
}: {
  name: string;
  description: string;
  disabledExplanation?: string;
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  value: string;
  onClick?: (event: React.MouseEvent) => void;
  onMouseEnter?: () => void;
}) {
  return (
    <RadioButtonWithTooltip
      title={`${name} – ${description}`}
      disabledTitle={`${name} – ${disabledExplanation}`}
      onMouseEnter={onMouseEnter}
      {...props}
    />
  );
}

function OverwriteModeSwitch({
  isControlOrMetaPressed,
  isShiftPressed,
  visible,
}: {
  isControlOrMetaPressed: boolean;
  isShiftPressed: boolean;
  visible: boolean;
}) {
  // Only CTRL should modify the overwrite mode. CTRL + Shift can be used to switch to the
  // erase tool, which should not affect the default overwrite mode.
  const overwriteMode = useSelector((state: OxalisState) => state.userConfiguration.overwriteMode);
  const previousIsControlOrMetaPressed = usePrevious(isControlOrMetaPressed);
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
    // Alternatively, we could store the selected value and the overridden value
    // separately in the store. However, this solution works, too.
    const needsModeToggle =
      (!isShiftPressed &&
        isControlOrMetaPressed &&
        previousIsControlOrMetaPressed === previousIsShiftPressed) ||
      (isShiftPressed === isControlOrMetaPressed &&
        !previousIsShiftPressed &&
        previousIsControlOrMetaPressed);

    if (needsModeToggle) {
      Store.dispatch(updateUserSettingAction("overwriteMode", toggleOverwriteMode(overwriteMode)));
    }
  }, [
    isControlOrMetaPressed,
    isShiftPressed,
    previousIsControlOrMetaPressed,
    previousIsShiftPressed,
  ]);

  if (!visible) {
    // This component's hooks should still be active, even when the component is invisible.
    // Otherwise, the toggling of the overwrite mode via "Ctrl" wouldn't work consistently
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
    ([leftButton, rightButton]: React.ReactNode[]) => [
      <FastTooltip title={tooltipTitle} key="leftButton">
        {React.cloneElement(leftButton as React.ReactElement<any, string>, {
          disabled: isDisabled,
        })}
      </FastTooltip>,
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

function SkeletonSpecificButtons() {
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
  const isUserAdminOrManager = useIsActiveUserAdminOrManager();

  const segmentationTracingLayer = useSelector((state: OxalisState) =>
    getActiveSegmentationTracing(state),
  );
  const isEditableMappingActive =
    segmentationTracingLayer != null && !!segmentationTracingLayer.hasEditableMapping;
  const isMappingLocked =
    segmentationTracingLayer != null && !!segmentationTracingLayer.mappingIsLocked;
  const isMergerModeDisabled = isEditableMappingActive || isMappingLocked;
  const mergerModeTooltipText = isEditableMappingActive
    ? "Merger mode cannot be enabled while an editable mapping is active."
    : isMappingLocked
      ? "Merger mode cannot be enabled while a mapping is locked. Please create a new annotation and use the merger mode there."
      : "Toggle Merger Mode - When enabled, skeletons that connect multiple segments will merge those segments.";

  const toggleNewNodeNewTreeMode = () =>
    dispatch(updateUserSettingAction("newNodeNewTree", !isNewNodeNewTreeModeOn));

  const toggleMergerMode = () => dispatch(setMergerModeEnabledAction(!isMergerModeEnabled));

  const isMaterializeVolumeAnnotationEnabled =
    dataset.dataStore.jobsSupportedByAvailableWorkers.includes(
      APIJobType.MATERIALIZE_VOLUME_ANNOTATION,
    );

  return (
    <Space.Compact
      style={{
        marginLeft: 10,
      }}
    >
      <CreateTreeButton />
      <ToggleButton
        style={NARROW_BUTTON_STYLE}
        onClick={toggleNewNodeNewTreeMode}
        active={isNewNodeNewTreeModeOn}
        title="Toggle the Single node Tree (soma clicking) mode - If enabled, each node creation will create a new tree."
      >
        <img
          style={imgStyleForSpaceyIcons}
          src="/assets/images/soma-clicking-icon.svg"
          alt="Single Node Tree Mode"
        />
      </ToggleButton>
      <ToggleButton
        active={isMergerModeEnabled}
        style={{
          ...NARROW_BUTTON_STYLE,
          opacity: isMergerModeDisabled ? 0.5 : 1,
        }}
        onClick={toggleMergerMode}
        disabled={isMergerModeDisabled}
        title={mergerModeTooltipText}
      >
        <img
          style={imgStyleForSpaceyIcons}
          src="/assets/images/merger-mode-icon.svg"
          alt="Merger Mode"
        />
      </ToggleButton>
      {isMergerModeEnabled && isMaterializeVolumeAnnotationEnabled && isUserAdminOrManager && (
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
    </Space.Compact>
  );
}

const mapId = (volumeTracingId: string | null | undefined, id: number) => {
  // Note that the return value can be an unmapped id even when
  // a mapping is active, if it is a HDF5 mapping that is partially loaded
  // and no entry exists yet for the input id.
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
    return rgbaToCSS(getSegmentColorAsRGBA(state, activeCellId));
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
  const activeTree = useSelector((state: OxalisState) => getActiveTree(state.tracing.skeleton));
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
    <FastTooltip title="Change the brush size">
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
                  defaultValue={defaultState.userConfiguration.brushSize}
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
    </FastTooltip>
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

  const [lastForcefullyDisabledTool, setLastForcefullyDisabledTool] =
    useState<AnnotationTool | null>(null);
  const isVolumeModificationAllowed = useSelector(
    (state: OxalisState) => !hasEditableMapping(state),
  );
  const useLegacyBindings = useSelector(
    (state: OxalisState) => state.userConfiguration.useLegacyBindings,
  );
  const activeTool = useSelector((state: OxalisState) => state.uiInformation.activeTool);
  const maybeMagWithZoomStep = useSelector(getRenderableMagForActiveSegmentationTracing);

  const labeledMag = maybeMagWithZoomStep != null ? maybeMagWithZoomStep.mag : null;
  const hasMagWithHigherDimension = (labeledMag || []).some((val) => val > 1);
  const multiSliceAnnotationInfoIcon = hasMagWithHigherDimension ? (
    <FastTooltip title="You are annotating in a low magnification. Depending on the used viewport, you might be annotating multiple slices at once.">
      <i
        className="fas fa-layer-group"
        style={{
          marginLeft: 4,
        }}
      />
    </FastTooltip>
  ) : null;

  const disabledInfosForTools = useSelector(getDisabledInfoForTools);
  // Ensure that no volume-tool is selected when being in merger mode.
  // Even though the volume toolbar is disabled, the user can still cycle through
  // the tools via the w shortcut. In that case, the effect-hook is re-executed
  // and the tool is switched to MOVE.
  const disabledInfoForCurrentTool = disabledInfosForTools[activeTool];
  const isLastForcefullyDisabledToolAvailable =
    lastForcefullyDisabledTool != null &&
    !disabledInfosForTools[lastForcefullyDisabledTool].isDisabled;

  useEffect(() => {
    if (disabledInfoForCurrentTool.isDisabled) {
      setLastForcefullyDisabledTool(activeTool);
      Store.dispatch(setToolAction(AnnotationToolEnum.MOVE));
    } else if (
      lastForcefullyDisabledTool != null &&
      isLastForcefullyDisabledToolAvailable &&
      activeTool === AnnotationToolEnum.MOVE
    ) {
      // Re-enable the tool that was disabled before.
      setLastForcefullyDisabledTool(null);
      Store.dispatch(setToolAction(lastForcefullyDisabledTool));
    } else if (activeTool !== AnnotationToolEnum.MOVE) {
      // Forget the last disabled tool as another tool besides the move tool was selected.
      setLastForcefullyDisabledTool(null);
    }
  }, [
    activeTool,
    disabledInfoForCurrentTool,
    isLastForcefullyDisabledToolAvailable,
    lastForcefullyDisabledTool,
  ]);

  const isShiftPressed = useKeyPress("Shift");
  const isControlOrMetaPressed = useKeyPress("ControlOrMeta");
  const isAltPressed = useKeyPress("Alt");
  const adaptedActiveTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
  );

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
          description="Use left-click to move around and right-click to open a context menu."
          disabledExplanation=""
          disabled={false}
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
            value={AnnotationToolEnum.SKELETON}
          >
            <i
              style={{
                opacity: disabledInfosForTools[AnnotationToolEnum.SKELETON].isDisabled ? 0.5 : 1,
              }}
              className="fas fa-project-diagram"
            />
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
              value={AnnotationToolEnum.PICK_CELL}
            >
              <i
                className="fas fa-eye-dropper"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.PICK_CELL].isDisabled ? 0.5 : 1,
                }}
              />
            </ToolRadioButton>
            <ToolRadioButton
              name={TOOL_NAMES.QUICK_SELECT}
              description="Click on a segment or draw a rectangle around it to automatically detect it"
              disabledExplanation={
                disabledInfosForTools[AnnotationToolEnum.QUICK_SELECT].explanation
              }
              disabled={disabledInfosForTools[AnnotationToolEnum.QUICK_SELECT].isDisabled}
              value={AnnotationToolEnum.QUICK_SELECT}
            >
              <img
                src="/assets/images/quick-select-tool.svg"
                alt="Quick Select Icon"
                style={{
                  opacity: disabledInfosForTools[AnnotationToolEnum.QUICK_SELECT].isDisabled
                    ? 0.5
                    : 1,
                  ...imgStyleForSpaceyIcons,
                }}
              />
            </ToolRadioButton>
          </React.Fragment>
        ) : null}
        <ToolRadioButton
          name={TOOL_NAMES.BOUNDING_BOX}
          description="Create, resize and modify bounding boxes."
          disabledExplanation={disabledInfosForTools[AnnotationToolEnum.BOUNDING_BOX].explanation}
          disabled={disabledInfosForTools[AnnotationToolEnum.BOUNDING_BOX].isDisabled}
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
            value={AnnotationToolEnum.PROOFREAD}
            onMouseEnter={() => {
              dispatch(ensureLayerMappingsAreLoadedAction());
            }}
          >
            <i
              className="fas fa-clipboard-check"
              style={{
                opacity: disabledInfosForTools[AnnotationToolEnum.PROOFREAD].isDisabled ? 0.5 : 1,
                padding: "0 4px",
              }}
            />
          </ToolRadioButton>
        ) : null}
        <ToolRadioButton
          name={TOOL_NAMES.LINE_MEASUREMENT}
          description="Use to measure distances or areas."
          disabledExplanation=""
          disabled={false}
          value={AnnotationToolEnum.LINE_MEASUREMENT}
        >
          <i className="fas fa-ruler" />
        </ToolRadioButton>
      </Radio.Group>

      <ToolSpecificSettings
        hasSkeleton={hasSkeleton}
        adaptedActiveTool={adaptedActiveTool}
        hasVolume={hasVolume}
        isControlOrMetaPressed={isControlOrMetaPressed}
        isShiftPressed={isShiftPressed}
      />
    </>
  );
}

function ToolSpecificSettings({
  hasSkeleton,
  adaptedActiveTool,
  hasVolume,
  isControlOrMetaPressed,
  isShiftPressed,
}: {
  hasSkeleton: boolean;
  adaptedActiveTool: AnnotationTool;
  hasVolume: boolean;
  isControlOrMetaPressed: boolean;
  isShiftPressed: boolean;
}) {
  const showSkeletonButtons = hasSkeleton && adaptedActiveTool === AnnotationToolEnum.SKELETON;
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
      {showSkeletonButtons ? <SkeletonSpecificButtons /> : null}

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
        isControlOrMetaPressed={isControlOrMetaPressed}
        isShiftPressed={isShiftPressed}
        visible={ToolsWithOverwriteCapabilities.includes(adaptedActiveTool)}
      />

      {adaptedActiveTool === "QUICK_SELECT" && (
        <>
          <ToggleButton
            active={!isQuickSelectHeuristic}
            style={{
              ...NARROW_BUTTON_STYLE,
              opacity: isQuickSelectHeuristic ? 0.5 : 1,
              marginLeft: 12,
            }}
            onClick={toggleQuickSelectStrategy}
            disabled={!isAISelectAvailable}
            title={quickSelectTooltipText}
          >
            <i className="fas fa-magic icon-margin-right" /> AI
          </ToggleButton>

          <QuickSelectSettingsPopover />
        </>
      )}

      {ToolsWithInterpolationCapabilities.includes(adaptedActiveTool) ? (
        <VolumeInterpolationButton />
      ) : null}

      {adaptedActiveTool === AnnotationToolEnum.FILL_CELL ? <FloodFillSettings /> : null}

      {adaptedActiveTool === AnnotationToolEnum.PROOFREAD ? <ProofReadingComponents /> : null}

      {MeasurementTools.includes(adaptedActiveTool) ? (
        <MeasurementToolSwitch activeTool={adaptedActiveTool} />
      ) : null}
    </>
  );
}

function IdentityComponent({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function NuxPopConfirm({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch();
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  return (
    <Popconfirm
      open
      title="Did you know?"
      showCancel={false}
      onConfirm={() => {
        if (!activeUser) {
          return;
        }
        const [newUserSync] = updateNovelUserExperienceInfos(activeUser, {
          hasSeenSegmentAnythingWithDepth: true,
        });
        dispatch(setActiveUserAction(newUserSync));
      }}
      description="The AI-based Quick Select can now be triggered with a single click. Also, it can be run for multiple sections at once (open the settings here to enable this)."
      overlayStyle={{ maxWidth: 400 }}
      icon={<InfoCircleOutlined style={{ color: "green" }} />}
    >
      {children}
    </Popconfirm>
  );
}

function QuickSelectSettingsPopover() {
  const dispatch = useDispatch();
  const { quickSelectState, areQuickSelectSettingsOpen } = useSelector(
    (state: OxalisState) => state.uiInformation,
  );
  const isQuickSelectActive = quickSelectState === "active";
  const activeUser = useSelector((state: OxalisState) => state.activeUser);

  const showNux =
    activeUser != null && !activeUser.novelUserExperienceInfos.hasSeenSegmentAnythingWithDepth;
  const Wrapper = showNux ? NuxPopConfirm : IdentityComponent;

  return (
    <>
      <Wrapper>
        <Popover
          trigger="click"
          placement="bottom"
          open={areQuickSelectSettingsOpen}
          content={<QuickSelectControls />}
          onOpenChange={(open: boolean) => {
            dispatch(showQuickSelectSettingsAction(open));
          }}
        >
          <ToggleButton
            title="Configure Quick Select"
            tooltipPlacement="right"
            className="narrow"
            active={isQuickSelectActive || showNux}
            style={{ marginLeft: 12, marginRight: 12 }}
          >
            <SettingOutlined />
          </ToggleButton>
        </Popover>
      </Wrapper>
    </>
  );
}

const handleSetFillMode = (event: RadioChangeEvent) => {
  Store.dispatch(updateUserSettingAction("fillMode", event.target.value));
};

function FloodFillSettings() {
  const dispatch = useDispatch();
  const isRestrictedToBoundingBox = useSelector(
    (state: OxalisState) => state.userConfiguration.isFloodfillRestrictedToBoundingBox,
  );
  const toggleRestrictFloodfillToBoundingBox = () => {
    dispatch(
      updateUserSettingAction("isFloodfillRestrictedToBoundingBox", !isRestrictedToBoundingBox),
    );
  };
  return (
    <div>
      <FillModeSwitch />

      <ButtonComponent
        style={{
          opacity: isRestrictedToBoundingBox ? 1 : 0.5,
          marginLeft: 12,
        }}
        type={isRestrictedToBoundingBox ? "primary" : "default"}
        onClick={toggleRestrictFloodfillToBoundingBox}
        title={
          "When enabled, the floodfill will be restricted to the bounding box enclosed by the clicked position. If multiple bounding boxes enclose that position, the smallest is used."
        }
      >
        <img
          src="/assets/images/icon-restrict-floodfill-to-bbox.svg"
          alt="Restrict floodfill"
          style={imgStyleForSpaceyIcons}
        />
      </ButtonComponent>
    </div>
  );
}

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
  const selectiveVisibilityInProofreading = useSelector(
    (state: OxalisState) => state.userConfiguration.selectiveVisibilityInProofreading,
  );

  return (
    <Space.Compact
      style={{
        marginLeft: 10,
      }}
    >
      <ButtonComponent
        title="Clear auxiliary meshes that were loaded while proofreading segments. Use this if you are done with correcting mergers or splits in a segment pair."
        onClick={handleClearProofreading}
        className="narrow"
        style={{ marginLeft: 12 }}
      >
        <ClearOutlined />
      </ButtonComponent>
      <ToggleButton
        title={`${autoRenderMeshes ? "Disable" : "Enable"} automatic loading of meshes`}
        active={autoRenderMeshes}
        style={NARROW_BUTTON_STYLE}
        onClick={() => handleToggleAutomaticMeshRendering(!autoRenderMeshes)}
      >
        <i className="fas fa-dice-d20" />
      </ToggleButton>
      <ToggleButton
        active={selectiveVisibilityInProofreading}
        title={`${
          selectiveVisibilityInProofreading ? "Disable" : "Enable"
        } selective segment visibility. When enabled, only hovered or active segments will be shown.`}
        style={NARROW_BUTTON_STYLE}
        onClick={() =>
          handleToggleSelectiveVisibilityInProofreading(!selectiveVisibilityInProofreading)
        }
      >
        <i className="fas fa-highlighter" />
      </ToggleButton>
    </Space.Compact>
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
          "Measure areas by using Left Drag. Avoid self-crossing polygon structure for accurate results."
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
