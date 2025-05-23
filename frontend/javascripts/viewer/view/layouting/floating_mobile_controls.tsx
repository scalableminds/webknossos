import { CaretDownOutlined, CaretUpOutlined, ExpandAltOutlined } from "@ant-design/icons";
import { Space, Tooltip } from "antd";
import { useRepeatedButtonTrigger, useWkSelector } from "libs/react_hooks";
import type * as React from "react";
import { OrthoViews, OrthoViewsToName } from "viewer/constants";
import * as MoveHandlers from "viewer/controller/combinations/move_handlers";
import { getMoveOffset, getMoveOffset3d } from "viewer/model/accessors/flycam_accessor";
import { moveFlycamAction } from "viewer/model/actions/flycam_actions";
import { Store } from "viewer/singletons";
import { layoutEmitter } from "viewer/view/layouting/layout_persistence";
import ButtonComponent from "../components/button_component";

const moveForward = (timeFactor: number, isFirst: boolean) =>
  MoveHandlers.moveW(getMoveOffset(Store.getState(), timeFactor), isFirst);
const moveBackward = (timeFactor: number, isFirst: boolean) =>
  MoveHandlers.moveW(-getMoveOffset(Store.getState(), timeFactor), isFirst);

const moveForwardArbitrary = (timeFactor: number) =>
  Store.dispatch(moveFlycamAction([0, 0, getMoveOffset3d(Store.getState(), timeFactor)]));
const moveBackwardArbitrary = (timeFactor: number) =>
  Store.dispatch(moveFlycamAction([0, 0, -getMoveOffset3d(Store.getState(), timeFactor)]));

const BUTTON_STYLE = { userSelect: "none", WebkitUserSelect: "none" } as const;
const ICON_TRANSFORM_VALUE = "scale(1)";

export function FloatingMobileControls() {
  const viewMode = useWkSelector((state) => state.temporaryConfiguration.viewMode);

  const moveForwardProps = useRepeatedButtonTrigger(
    viewMode === "orthogonal" ? moveForward : moveForwardArbitrary,
  );
  const moveBackwardProps = useRepeatedButtonTrigger(
    viewMode === "orthogonal" ? moveBackward : moveBackwardArbitrary,
  );
  const activeViewport = useWkSelector((state) => state.viewModeData.plane.activeViewport);
  const handleContextMenu = (event: React.SyntheticEvent) => {
    event.preventDefault();
  };

  return (
    <div
      className="floating-buttons-bar"
      style={{ position: "fixed", left: 8, bottom: 28, zIndex: 1000 }}
      onContextMenu={handleContextMenu}
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
        {viewMode === "orthogonal" && (
          <Tooltip title="The navigation and maximization button refers to the active viewport. A viewport can be activated by tapping on it.">
            <ButtonComponent size="large" shape="circle" style={BUTTON_STYLE}>
              {OrthoViewsToName[activeViewport]}
            </ButtonComponent>
          </Tooltip>
        )}
      </Space>
    </div>
  );
}
