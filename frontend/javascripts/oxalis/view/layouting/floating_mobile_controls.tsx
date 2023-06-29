import { CaretDownOutlined, CaretUpOutlined, ExpandAltOutlined } from "@ant-design/icons";
import { Space, Tooltip } from "antd";
import { useRepeatedButtonTrigger } from "libs/react_hooks";
import { OrthoViews, OrthoViewsToName } from "oxalis/constants";
import * as MoveHandlers from "oxalis/controller/combinations/move_handlers";
import { OxalisState } from "oxalis/store";
import { layoutEmitter } from "oxalis/view/layouting/layout_persistence";
import * as React from "react";
import { useSelector } from "react-redux";
import ButtonComponent from "../components/button_component";

const moveForward = () => {
  return MoveHandlers.moveW(1, true);
};
const moveBackward = () => MoveHandlers.moveW(-1, true);

const BUTTON_STYLE = { userSelect: "none", WebkitUserSelect: "none" } as const;
const ICON_TRANSFORM_VALUE = "scale(1)";

export function FloatingMobileControls() {
  const moveForwardProps = useRepeatedButtonTrigger(moveForward);
  const moveBackwardProps = useRepeatedButtonTrigger(moveBackward);
  const activeViewport = useSelector(
    (store: OxalisState) => store.viewModeData.plane.activeViewport,
  );

  return (
    <div
      className="floating-buttons-bar"
      style={{ position: "fixed", left: 8, bottom: 28, zIndex: 1000 }}
    >
      <Space>
        <ButtonComponent
          size="large"
          type="primary"
          shape="circle"
          style={BUTTON_STYLE}
          onClick={() => layoutEmitter.emit("toggleBorder", "left")}
          icon={
            <img
              alt="Toggle left sidebar"
              src="/assets/images/icon-sidebar-hide-left-bright.svg"
              style={{ filter: "brightness(10)", transform: ICON_TRANSFORM_VALUE }}
            />
          }
        />
        <ButtonComponent
          size="large"
          type="primary"
          shape="circle"
          style={BUTTON_STYLE}
          onClick={() => layoutEmitter.emit("toggleBorder", "right")}
          icon={
            <img
              alt="Toggle right sidebar"
              src="/assets/images/icon-sidebar-hide-right-bright.svg"
              style={{ filter: "brightness(10)", transform: ICON_TRANSFORM_VALUE }}
            />
          }
        />
        <ButtonComponent
          size="large"
          type="primary"
          shape="circle"
          style={BUTTON_STYLE}
          disabled={activeViewport === OrthoViews.TDView}
          icon={<CaretUpOutlined style={{ transform: ICON_TRANSFORM_VALUE }} />}
          {...moveForwardProps}
        />
        <ButtonComponent
          size="large"
          type="primary"
          shape="circle"
          style={BUTTON_STYLE}
          disabled={activeViewport === OrthoViews.TDView}
          icon={<CaretDownOutlined style={{ transform: ICON_TRANSFORM_VALUE }} />}
          {...moveBackwardProps}
        />
        <ButtonComponent
          size="large"
          type="primary"
          shape="circle"
          style={BUTTON_STYLE}
          onClick={() => layoutEmitter.emit("toggleMaximize")}
          icon={<ExpandAltOutlined style={{ transform: ICON_TRANSFORM_VALUE }} />}
        />
        <Tooltip title="The navigation and maximization button refers to the active viewport. A viewport can be activated by tapping on it.">
          <ButtonComponent size="large" shape="circle" style={BUTTON_STYLE}>
            {OrthoViewsToName[activeViewport]}
          </ButtonComponent>
        </Tooltip>
      </Space>
    </div>
  );
}
