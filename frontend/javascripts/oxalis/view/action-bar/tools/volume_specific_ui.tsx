import {
  ClearOutlined,
  DownOutlined,
  InfoCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  Badge,
  Dropdown,
  type MenuProps,
  Popconfirm,
  Popover,
  Radio,
  type RadioChangeEvent,
  Space,
} from "antd";
import React, { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

import { usePrevious } from "libs/react_hooks";
import {
  FillModeEnum,
  type InterpolationMode,
  InterpolationModeEnum,
  MappingStatusEnum,
  type OverwriteMode,
  OverwriteModeEnum,
} from "oxalis/constants";
import {
  getActiveSegmentationTracing,
  getMappingInfoForVolumeTracing,
  getSegmentColorAsRGBA,
} from "oxalis/model/accessors/volumetracing_accessor";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { showQuickSelectSettingsAction } from "oxalis/model/actions/ui_actions";
import {
  createCellAction,
  interpolateSegmentationLayerAction,
} from "oxalis/model/actions/volumetracing_actions";
import { Model } from "oxalis/singletons";
import Store, { type OxalisState } from "oxalis/store";
import ButtonComponent, { ToggleButton } from "oxalis/view/components/button_component";
import { showToastWarningForLargestSegmentIdMissing } from "oxalis/view/largest_segment_id_modal";

import { updateNovelUserExperienceInfos } from "admin/admin_rest_api";
import FastTooltip from "components/fast_tooltip";
import { clearProofreadingByProducts } from "oxalis/model/actions/proofread_actions";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { getInterpolationInfo } from "oxalis/model/sagas/volume/volume_interpolation_saga";
import { rgbaToCSS } from "oxalis/shaders/utils.glsl";
import type { MenuInfo } from "rc-menu/lib/interface";
import { QuickSelectControls } from "../quick_select_settings";
import {
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
          style={IMG_STYLE_FOR_SPACEY_ICONS}
        />
      </RadioButtonWithTooltip>
      <RadioButtonWithTooltip
        title="Only overwrite empty areas. In case of erasing, only the current segment ID is overwritten. This setting can be toggled by holding CTRL."
        value={OverwriteModeEnum.OVERWRITE_EMPTY}
      >
        <img
          src="/assets/images/overwrite-empty.svg"
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

export function QuickSelectSettingsPopover() {
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

export function FloodFillSettings() {
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
          display: "inline-block",
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
          style={IMG_STYLE_FOR_SPACEY_ICONS}
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

export function ProofreadingComponents() {
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
