import { CaretDownOutlined, CaretUpOutlined, ExpandAltOutlined } from "@ant-design/icons";
import { ConfigProvider, Space, Tooltip } from "antd";
import { ThemedIcon } from "components/themed_icon";
import { useRepeatedButtonTrigger, useWkSelector } from "libs/react_hooks";
import type * as React from "react";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { getAntdTheme } from "theme";
import { OrthoViews, OrthoViewsToName } from "viewer/constants";
import { moveW } from "viewer/controller/combinations/move_handlers";
import { getMoveOffset, getMoveOffset3d } from "viewer/model/accessors/flycam_accessor";
import { moveFlycamAction } from "viewer/model/actions/flycam_actions";
import { Store } from "viewer/singletons";
import { LayoutEvents, layoutEmitter } from "viewer/view/layouting/layout_persistence";
import ButtonComponent from "../components/button_component";

const moveForward = (timeFactor: number, isFirst: boolean) =>
  moveW(getMoveOffset(Store.getState(), timeFactor), isFirst);
const moveBackward = (timeFactor: number, isFirst: boolean) =>
  moveW(-getMoveOffset(Store.getState(), timeFactor), isFirst);

const BUTTON_STYLE = { userSelect: "none", WebkitUserSelect: "none" } as const;

export function FloatingMobileControls() {
  const dispatch = useDispatch();
  const viewMode = useWkSelector((state) => state.temporaryConfiguration.viewMode);

  const moveForwardArbitrary = useCallback(
    (timeFactor: number) =>
      dispatch(moveFlycamAction([0, 0, getMoveOffset3d(Store.getState(), timeFactor)])),
    [dispatch],
  );
  const moveBackwardArbitrary = useCallback(
    (timeFactor: number) =>
      dispatch(moveFlycamAction([0, 0, -getMoveOffset3d(Store.getState(), timeFactor)])),
    [dispatch],
  );

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
  const lightTheme = getAntdTheme("light");

  return (
    <ConfigProvider theme={lightTheme}>
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
            onClick={() => layoutEmitter.emit(LayoutEvents.toggleBorder, "left")}
            icon={
              <ThemedIcon
                name="icon-sidebar-hide-left"
                aria-label="Toggle left sidebar"
                style={{ filter: "brightness(10)" }}
              />
            }
          />
          <ButtonComponent
            size="large"
            type="primary"
            shape="circle"
            style={BUTTON_STYLE}
            onClick={() => layoutEmitter.emit(LayoutEvents.toggleBorder, "right")}
            icon={
              <ThemedIcon
                name="icon-sidebar-hide-right"
                aria-label="Toggle right sidebar"
                style={{ filter: "brightness(10)" }}
              />
            }
          />
          <ButtonComponent
            size="large"
            type="primary"
            shape="circle"
            style={BUTTON_STYLE}
            disabled={activeViewport === OrthoViews.TDView}
            icon={<CaretUpOutlined />}
            {...moveForwardProps}
          />
          <ButtonComponent
            size="large"
            type="primary"
            shape="circle"
            style={BUTTON_STYLE}
            disabled={activeViewport === OrthoViews.TDView}
            icon={<CaretDownOutlined />}
            {...moveBackwardProps}
          />
          <ButtonComponent
            size="large"
            type="primary"
            shape="circle"
            style={BUTTON_STYLE}
            onClick={() => layoutEmitter.emit(LayoutEvents.toggleMaximize)}
            icon={<ExpandAltOutlined />}
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
    </ConfigProvider>
  );
}
