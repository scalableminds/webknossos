import {
  Button,
  Radio,
  Tooltip,
  Dropdown,
  Col,
  Row,
  Switch,
  RadioChangeEvent,
  MenuProps,
  Space,
} from "antd";
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
import type { TDViewDisplayMode } from "oxalis/constants";
import { TDViewDisplayModeEnum } from "oxalis/constants";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { api } from "oxalis/singletons";
import { SwitchChangeEventHandler } from "antd/lib/switch";
type Props = {
  tdViewDisplayPlanes: TDViewDisplayMode;
  tdViewDisplayDatasetBorders: boolean;
  tdViewDisplayLayerBorders: boolean;
  onChangeTdViewDisplayPlanes: (arg0: RadioChangeEvent) => void;
  onChangeTdViewDisplayDatasetBorders: SwitchChangeEventHandler;
  onChangeTdViewDisplayLayerBorders: SwitchChangeEventHandler;
};

function TDViewControls({
  tdViewDisplayPlanes,
  tdViewDisplayDatasetBorders,
  tdViewDisplayLayerBorders,
  onChangeTdViewDisplayPlanes,
  onChangeTdViewDisplayDatasetBorders,
  onChangeTdViewDisplayLayerBorders,
}: Props) {
  const settingsMenu: MenuProps = {
    style: {
      width: 260,
    },
    items: [
      {
        key: "tdViewDisplayPlanes",
        label: (
          <Row>
            <Col span={14}>
              <label className="setting-label">Plane Display Mode</label>
            </Col>
            <Col span={10}>
              <Radio.Group
                value={tdViewDisplayPlanes}
                onChange={onChangeTdViewDisplayPlanes}
                size="small"
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
        ),
      },
      {
        key: "showDatasetBorder",
        label: (
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
        ),
      },
      {
        key: "showLayerBorders",
        label: (
          <Row>
            <Col span={14}>
              <label className="setting-label">Show Layer Borders</label>
            </Col>
            <Col span={10}>
              <Switch
                checked={tdViewDisplayLayerBorders}
                onChange={onChangeTdViewDisplayLayerBorders}
              />
            </Col>
          </Row>
        ),
      },
    ],
  };

  return (
    <Space.Compact id="TDViewControls">
      <Button size="small" onClick={() => api.tracing.rotate3DViewToDiagonal()}>
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
      <Dropdown menu={settingsMenu} placement="bottomRight" trigger={["click"]}>
        <Button size="small">
          <SettingOutlined />
        </Button>
      </Dropdown>
    </Space.Compact>
  );
}

function mapStateToProps(state: OxalisState) {
  return {
    tdViewDisplayPlanes: state.userConfiguration.tdViewDisplayPlanes,
    tdViewDisplayDatasetBorders: state.userConfiguration.tdViewDisplayDatasetBorders,
    tdViewDisplayLayerBorders: state.userConfiguration.tdViewDisplayLayerBorders,
  };
}

function mapDispatchToProps(dispatch: Dispatch<any>) {
  return {
    onChangeTdViewDisplayPlanes(evt: RadioChangeEvent) {
      const tdViewDisplayPlanes: TDViewDisplayModeEnum = evt.target.value;
      dispatch(updateUserSettingAction("tdViewDisplayPlanes", tdViewDisplayPlanes));
    },

    onChangeTdViewDisplayDatasetBorders(tdViewDisplayDatasetBorders: boolean) {
      dispatch(updateUserSettingAction("tdViewDisplayDatasetBorders", tdViewDisplayDatasetBorders));
    },

    onChangeTdViewDisplayLayerBorders(tdViewDisplayLayerBorders: boolean) {
      dispatch(updateUserSettingAction("tdViewDisplayLayerBorders", tdViewDisplayLayerBorders));
    },
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(TDViewControls);
