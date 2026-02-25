import {
  ClearOutlined,
  DownOutlined,
  InfoCircleOutlined,
  ScissorOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { updateNovelUserExperienceInfos } from "admin/rest_api";
import {
  Badge,
  Button,
  Dropdown,
  type MenuProps,
  Popconfirm,
  Popover,
  Radio,
  type RadioChangeEvent,
  Space,
} from "antd";
import FastTooltip from "components/fast_tooltip";
import { usePrevious, useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import {
  FillModeEnum,
  type InterpolationMode,
  InterpolationModeEnum,
  MappingStatusEnum,
  type OverwriteMode,
  OverwriteModeEnum,
} from "viewer/constants";
import {
  getActiveSegmentationTracing,
  getMappingInfoForVolumeTracing,
  getSegmentColorAsRGBA,
} from "viewer/model/accessors/volumetracing_accessor";
import { clearProofreadingByProducts } from "viewer/model/actions/proofread_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { showQuickSelectSettingsAction } from "viewer/model/actions/ui_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import {
  createCellAction,
  interpolateSegmentationLayerAction,
} from "viewer/model/actions/volumetracing_actions";
import { getInterpolationInfo } from "viewer/model/sagas/volume/volume_interpolation_saga";
import { rgbaToCSS } from "viewer/shaders/utils.glsl";
import { Model } from "viewer/singletons";
import Store from "viewer/store";
import ButtonComponent, { ToggleButton } from "viewer/view/components/button_component";
import { showToastWarningForLargestSegmentIdMissing } from "viewer/view/largest_segment_id_modal";
import { QuickSelectControls } from "../quick_select_settings";
import {
  ACTIONBAR_MARGIN_LEFT,
  IMG_STYLE_FOR_SPACEY_ICONS,
  NARROW_BUTTON_STYLE,
  RadioButtonWithTooltip,
} from "./tool_helpers";

function toggleOverwriteMode(overwriteMode: OverwriteMode) {
  if (overwriteMode === OverwriteModeEnum.OVERWRITE_ALL) {
    return OverwriteModeEnum.OVERWRITE_EMPTY;
  } else {
    return OverwriteModeEnum.OVERWRITE_ALL;
  }
}

const handleToggleAutomaticMeshRendering = (value: boolean) => {
  Store.dispatch(updateUserSettingAction("autoRenderMeshInProofreading", value));
};

const handleToggleSelectiveVisibilityInProofreading = (value: boolean) => {
  Store.dispatch(updateUserSettingAction("selectiveVisibilityInProofreading", value));
};

const handleToggleIsMultiSplitActive = (value: boolean) => {
  Store.dispatch(updateUserSettingAction("isMultiSplitActive", value));
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

const handleSetOverwriteMode = (event: {
  target: {
    value: OverwriteMode;
  };
}) => {
  Store.dispatch(updateUserSettingAction("overwriteMode", event.target.value));
};

export function OverwriteModeSwitch({
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
  const overwriteMode = useWkSelector((state) => state.userConfiguration.overwriteMode);
  const [previousIsControlOrMetaPressed] = usePrevious(isControlOrMetaPressed);
  const [previousIsShiftPressed] = usePrevious(isShiftPressed);
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
        marginLeft: ACTIONBAR_MARGIN_LEFT,
      }}
    >
      <RadioButtonWithTooltip
        title="Overwrite everything. This setting can be toggled by holding CTRL."
        value={OverwriteModeEnum.OVERWRITE_ALL}
      >
        <img
          src="/images/overwrite-all.svg"
          alt="Overwrite All Icon"
          style={IMG_STYLE_FOR_SPACEY_ICONS}
        />
      </RadioButtonWithTooltip>
      <RadioButtonWithTooltip
        title="Only overwrite empty areas. In case of erasing, only the current segment ID is overwritten. This setting can be toggled by holding CTRL."
        value={OverwriteModeEnum.OVERWRITE_EMPTY}
      >
        <img
          src="/images/overwrite-empty.svg"
          alt="Overwrite Empty Icon"
          style={IMG_STYLE_FOR_SPACEY_ICONS}
        />
      </RadioButtonWithTooltip>
    </Radio.Group>
  );
}

const INTERPOLATION_ICON = {
  [InterpolationModeEnum.INTERPOLATE]: <i className="fas fa-align-center fa-rotate-90" />,
  [InterpolationModeEnum.EXTRUDE]: <i className="fas fa-align-justify fa-rotate-90" />,
};

export function VolumeInterpolationButton() {
  const dispatch = useDispatch();
  const interpolationMode = useWkSelector((state) => state.userConfiguration.interpolationMode);

  const onInterpolateClick = (e: React.MouseEvent<HTMLElement> | null) => {
    e?.currentTarget.blur();
    dispatch(interpolateSegmentationLayerAction());
  };

  const { tooltipTitle, isDisabled } = useWkSelector((state) =>
    getInterpolationInfo(state, "Not available since"),
  );

  const menu: MenuProps = {
    onClick: (e) => {
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

  return (
    // Without the outer div, the Dropdown can eat up all the remaining horizontal space,
    // moving sibling elements to the far right.
    <div>
      <Space.Compact>
        <FastTooltip title={tooltipTitle}>
          <Button
            icon={INTERPOLATION_ICON[interpolationMode]}
            onClick={onInterpolateClick}
            disabled={isDisabled}
            style={{ padding: "0 5px 0 6px" }}
          />
        </FastTooltip>
        <Dropdown menu={menu}>
          <Button icon={<DownOutlined />} disabled={isDisabled} />
        </Dropdown>
      </Space.Compact>
    </div>
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

export function CreateSegmentButton() {
  const volumeTracingId = useWkSelector((state) => getActiveSegmentationTracing(state)?.tracingId);
  const unmappedActiveCellId = useWkSelector(
    (state) => getActiveSegmentationTracing(state)?.activeCellId || 0,
  );
  const { mappingStatus } = useWkSelector((state) =>
    getMappingInfoForVolumeTracing(state, volumeTracingId),
  );
  const isMappingEnabled = mappingStatus === MappingStatusEnum.ENABLED;

  const activeCellId = isMappingEnabled
    ? mapId(volumeTracingId, unmappedActiveCellId)
    : unmappedActiveCellId;

  const activeCellColor = useWkSelector((state) => {
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
        }}
        title={`Create a new segment id (C) – The active segment id is ${unmappedActiveCellId}${mappedIdInfo}.`}
      >
        <img src="/images/new-cell.svg" alt="New Segment Icon" />
      </ButtonComponent>
    </Badge>
  );
}

function IdentityComponent({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function NuxPopConfirm({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch();
  const activeUser = useWkSelector((state) => state.activeUser);
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
      styles={{ root: { maxWidth: 400 } }}
      icon={<InfoCircleOutlined style={{ color: "green" }} />}
    >
      {children}
    </Popconfirm>
  );
}

export function QuickSelectSettingsPopover() {
  const dispatch = useDispatch();
  const { quickSelectState, areQuickSelectSettingsOpen } = useWkSelector(
    (state) => state.uiInformation,
  );
  const isQuickSelectActive = quickSelectState === "active";
  const activeUser = useWkSelector((state) => state.activeUser);

  const showNux =
    activeUser != null && !activeUser.novelUserExperienceInfos.hasSeenSegmentAnythingWithDepth;
  const Wrapper = showNux ? NuxPopConfirm : IdentityComponent;

  return (
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
          style={{ marginLeft: ACTIONBAR_MARGIN_LEFT }}
        >
          <SettingOutlined />
        </ToggleButton>
      </Popover>
    </Wrapper>
  );
}

const handleSetFillMode = (event: RadioChangeEvent) => {
  Store.dispatch(updateUserSettingAction("fillMode", event.target.value));
};

export function FloodFillSettings() {
  const dispatch = useDispatch();
  const isRestrictedToBoundingBox = useWkSelector(
    (state) => state.userConfiguration.isFloodfillRestrictedToBoundingBox,
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
          marginLeft: ACTIONBAR_MARGIN_LEFT,
        }}
        type={isRestrictedToBoundingBox ? "primary" : "default"}
        onClick={toggleRestrictFloodfillToBoundingBox}
        title={
          "When enabled, the floodfill will be restricted to the bounding box enclosed by the clicked position. If multiple bounding boxes enclose that position, the smallest is used."
        }
        icon={
          <img
            src="/images/icon-restrict-floodfill-to-bbox.svg"
            alt="Restrict floodfill"
            style={IMG_STYLE_FOR_SPACEY_ICONS}
          />
        }
      />
    </div>
  );
}

function FillModeSwitch() {
  const fillMode = useWkSelector((state) => state.userConfiguration.fillMode);
  return (
    <Radio.Group value={fillMode} onChange={handleSetFillMode}>
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

export function ProofreadingComponents() {
  const dispatch = useDispatch();
  const handleClearProofreading = () => dispatch(clearProofreadingByProducts());
  const autoRenderMeshes = useWkSelector(
    (state) => state.userConfiguration.autoRenderMeshInProofreading,
  );
  const selectiveVisibilityInProofreading = useWkSelector(
    (state) => state.userConfiguration.selectiveVisibilityInProofreading,
  );

  const isMultiSplitActive = useWkSelector((state) => state.userConfiguration.isMultiSplitActive);

  return (
    <Space.Compact>
      <ButtonComponent
        title="Clear auxiliary meshes that were loaded while proofreading segments. Use this if you are done with correcting mergers or splits in a segment pair."
        onClick={handleClearProofreading}
        className="narrow"
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
      <ToggleButton
        active={isMultiSplitActive}
        title={`${
          isMultiSplitActive ? "Disable" : "Enable"
        } multi splitting. When enabled, two partitions can be selected in the orthogonal or 3D viewports to split more accurately.`}
        style={NARROW_BUTTON_STYLE}
        onClick={() => handleToggleIsMultiSplitActive(!isMultiSplitActive)}
      >
        <ScissorOutlined />
      </ToggleButton>
    </Space.Compact>
  );
}
