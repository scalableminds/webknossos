// @flow
import { Button, Radio, Tooltip, Menu, Dropdown, Col, Row, Switch } from "antd";
import {
  StopOutlined,
  BorderInnerOutlined,
  BorderOuterOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import * as React from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import type { OxalisState } from "oxalis/store";
import { TDViewDisplayModeEnum, type TDViewDisplayMode } from "oxalis/constants";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";

import api from "oxalis/api/internal_api";

type Props = {|
  tdViewDisplayPlanes: TDViewDisplayMode,
  tdViewDisplayDatasetBorders: boolean,
  onChangeTdViewDisplayPlanes: (SyntheticInputEvent<>) => void,
  onChangeTdViewDisplayDatasetBorders: boolean => void,
|};

function TDViewControls({
  tdViewDisplayPlanes,
  tdViewDisplayDatasetBorders,
  onChangeTdViewDisplayPlanes,
  onChangeTdViewDisplayDatasetBorders,
}: Props) {
  const settingsMenu = (
    <Menu style={{ width: 260 }}>
      <Menu.Item key="tdViewDisplayPlanes">
        <Row>
          <Col span={14}>
            <label className="setting-label">Plane Display Mode</label>
          </Col>
          <Col span={10}>
            <Radio.Group
              value={tdViewDisplayPlanes}
              onChange={onChangeTdViewDisplayPlanes}
              size="small"
              className="without-icon-margin"
            >
              <Tooltip title="Hide Planes">
                <Radio.Button value={TDViewDisplayModeEnum.NONE}>
                  <StopOutlined />
                </Radio.Button>
              </Tooltip>
              <Tooltip title="Show Wireframes Only">
                <Radio.Button value={TDViewDisplayModeEnum.WIREFRAME}>
                  <BorderInnerOutlined />
                </Radio.Button>
              </Tooltip>
              <Tooltip title="Show Planes with Data">
                <Radio.Button value={TDViewDisplayModeEnum.DATA}>
                  <BorderOuterOutlined />
                </Radio.Button>
              </Tooltip>
            </Radio.Group>
          </Col>
        </Row>
      </Menu.Item>
      <Menu.Item key="showDatasetBorder">
        <Row>
          <Col span={14}>
            <label className="setting-label">Show Dataset Border</label>
          </Col>
          <Col span={10}>
            <Switch
              checked={tdViewDisplayDatasetBorders}
              onChange={onChangeTdViewDisplayDatasetBorders}
            />
          </Col>
        </Row>
      </Menu.Item>
    </Menu>
  );

  return (
    <div id="TDViewControls" className="antd-legacy-group">
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
    tdViewDisplayPlanes: state.userConfiguration.tdViewDisplayPlanes,
    tdViewDisplayDatasetBorders: state.userConfiguration.tdViewDisplayDatasetBorders,
  };
}

function mapDispatchToProps(dispatch: Dispatch<*>) {
  return {
    onChangeTdViewDisplayPlanes(evt: SyntheticInputEvent<>) {
      const tdViewDisplayPlanes: $Values<typeof TDViewDisplayModeEnum> = evt.target.value;
      dispatch(updateUserSettingAction("tdViewDisplayPlanes", tdViewDisplayPlanes));
    },
    onChangeTdViewDisplayDatasetBorders(tdViewDisplayDatasetBorders: boolean) {
      dispatch(updateUserSettingAction("tdViewDisplayDatasetBorders", tdViewDisplayDatasetBorders));
    },
  };
}

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(TDViewControls);
