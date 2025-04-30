import { SettingOutlined } from "@ant-design/icons";
import { Col, Divider, Dropdown, type MenuProps, Popover, Row } from "antd";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { Unicode } from "oxalis/constants";
import { getMaximumBrushSize } from "oxalis/model/accessors/volumetracing_accessor";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setMousePositionAction } from "oxalis/model/actions/volumetracing_actions";
import Store, { type BrushPresets, type WebknossosState } from "oxalis/store";
import ButtonComponent from "oxalis/view/components/button_component";
import { LogSliderSetting } from "oxalis/view/components/setting_input_views";
import { userSettings } from "types/schemas/user_settings.schema";

import FastTooltip from "components/fast_tooltip";
import defaultState from "oxalis/default_state";
import { getViewportExtents } from "oxalis/model/accessors/view_mode_accessor";

const handleUpdateBrushSize = (value: number) => {
  Store.dispatch(updateUserSettingAction("brushSize", value));
};

const handleUpdatePresetBrushSizes = (brushSizes: BrushPresets) => {
  Store.dispatch(updateUserSettingAction("presetBrushSizes", brushSizes));
};

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

export function ChangeBrushSizePopover() {
  const dispatch = useDispatch();
  const brushSize = useSelector((state: WebknossosState) => state.userConfiguration.brushSize);
  const [isBrushSizePopoverOpen, setIsBrushSizePopoverOpen] = useState(false);
  const maximumBrushSize = useSelector((state: WebknossosState) => getMaximumBrushSize(state));

  const defaultBrushSizes = getDefaultBrushSizes(maximumBrushSize, userSettings.brushSize.minimum);
  const presetBrushSizes = useSelector(
    (state: WebknossosState) => state.userConfiguration.presetBrushSizes,
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
