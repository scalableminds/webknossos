// @flow
import { Button, Radio, Tooltip, Menu, Dropdown } from "antd";
import {
  ReloadOutlined,
  StopOutlined,
  BorderInnerOutlined,
  BorderOuterOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import * as React from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import type { OxalisState, VolumeTracing } from "oxalis/store";
import { TDViewDisplayModeEnum, type TDViewDisplayMode } from "oxalis/constants";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";

import api from "oxalis/api/internal_api";

type Props = {|
  isRefreshingIsosurfaces: boolean,
  volumeTracing: ?VolumeTracing,
  tdViewDisplayPlanes: TDViewDisplayMode,
  onChangeTdViewDisplayPlanes: (SyntheticInputEvent<>) => void,
|};

function TDViewControls({
  isRefreshingIsosurfaces,
  volumeTracing,
  tdViewDisplayPlanes,
  onChangeTdViewDisplayPlanes,
}: Props) {
  let refreshIsosurfaceTooltip = "Load Isosurface of centered cell from segmentation layer.";
  if (volumeTracing != null) {
    if (volumeTracing.fallbackLayer != null) {
      refreshIsosurfaceTooltip = "Load Isosurface of centered cell from fallback annotation layer";
    } else {
      refreshIsosurfaceTooltip = "Reload annotated Isosurfaces to newest version.";
    }
  }

  const settingsMenu = (
    <Menu>
      <Menu.ItemGroup title="Plane Display Mode">
        <Menu.Item>
          <Radio.Group
            value={tdViewDisplayPlanes}
            onChange={onChangeTdViewDisplayPlanes}
            size="small"
          >
            <Tooltip title="Hide everything">
              <Radio.Button value={TDViewDisplayModeEnum.NONE}>
                <StopOutlined />
              </Radio.Button>
            </Tooltip>
            <Tooltip title="Show wireframes only">
              <Radio.Button value={TDViewDisplayModeEnum.WIREFRAME}>
                <BorderInnerOutlined />
              </Radio.Button>
            </Tooltip>
            <Tooltip title="Show planes with data">
              <Radio.Button value={TDViewDisplayModeEnum.DATA}>
                <BorderOuterOutlined />
              </Radio.Button>
            </Tooltip>
          </Radio.Group>
        </Menu.Item>
      </Menu.ItemGroup>
    </Menu>
  );

  return (
    <div id="TDViewControls" className="antd-legacy-group without-icon-margin">
      <Button size="small" onClick={api.tracing.rotate3DViewToDiagonal}>
        3D
      </Button>
      <Button size="small" onClick={api.tracing.rotate3DViewToXY}>
        <span className="colored-dot" />
        XY
      </Button>
      <Button size="small" onClick={api.tracing.rotate3DViewToYZ}>
        <span className="colored-dot" />
        YZ
      </Button>
      <Button size="small" onClick={api.tracing.rotate3DViewToXZ}>
        <span className="colored-dot" />
        XZ
      </Button>
      <Tooltip title={refreshIsosurfaceTooltip}>
        <Button
          size="small"
          loading={isRefreshingIsosurfaces}
          onClick={api.data.refreshIsosurfaces}
        >
          <ReloadOutlined />
        </Button>
      </Tooltip>
      <Dropdown overlay={settingsMenu} placement="bottomRight" trigger={["click"]}>
        <Button size="small">
          <SettingOutlined />
        </Button>
      </Dropdown>
    </div>
  );
}

function mapStateToProps(state: OxalisState) {
  return {
    isRefreshingIsosurfaces: state.uiInformation.isRefreshingIsosurfaces,
    volumeTracing: state.tracing.volume,
    tdViewDisplayPlanes: state.userConfiguration.tdViewDisplayPlanes,
  };
}

function mapDispatchToProps(dispatch: Dispatch<*>) {
  return {
    onChangeTdViewDisplayPlanes(evt: SyntheticInputEvent<>) {
      const tdViewDisplayPlanes: $Values<typeof TDViewDisplayModeEnum> = evt.target.value;
      dispatch(updateUserSettingAction("tdViewDisplayPlanes", tdViewDisplayPlanes));
    },
  };
}

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(TDViewControls);
