import { SettingOutlined } from "@ant-design/icons";
import { getConnectomeFilesForDatasetLayer } from "admin/admin_rest_api";
import { Col, Popover, Row, Select, Tooltip } from "antd";
import { settings } from "messages";
import defaultState from "oxalis/default_state";
import {
  updateConnectomeFileListAction,
  updateCurrentConnectomeFileAction,
} from "oxalis/model/actions/connectome_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import ButtonComponent from "oxalis/view/components/button_component";
import { NumberSliderSetting } from "oxalis/view/components/setting_input_views";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import React from "react";
import { connect } from "react-redux";
import type { APIConnectomeFile, APIDataset, APISegmentationLayer } from "types/api_types";
import { userSettings } from "types/schemas/user_settings.schema";
const { Option } = Select;
type OwnProps = {
  segmentationLayer: APISegmentationLayer | null | undefined;
};
type StateProps = {
  dataset: APIDataset;
  availableConnectomeFiles: Array<APIConnectomeFile> | null | undefined;
  currentConnectomeFile: APIConnectomeFile | null | undefined;
  pendingConnectomeFileName: string | null | undefined;
  particleSize: number;
};
type Props = OwnProps & StateProps;

const mapStateToProps = (state: OxalisState, ownProps: OwnProps): StateProps => {
  const { segmentationLayer } = ownProps;
  const connectomeData =
    segmentationLayer != null
      ? state.localSegmentationData[segmentationLayer.name].connectomeData
      : null;
  return {
    dataset: state.dataset,
    availableConnectomeFiles:
      connectomeData != null ? connectomeData.availableConnectomeFiles : null,
    currentConnectomeFile: connectomeData != null ? connectomeData.currentConnectomeFile : null,
    pendingConnectomeFileName:
      connectomeData != null ? connectomeData.pendingConnectomeFileName : null,
    particleSize: state.userConfiguration.particleSize,
  };
};

class ConnectomeFilters extends React.Component<Props> {
  componentDidMount() {
    this.maybeFetchConnectomeFiles();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.segmentationLayer !== this.props.segmentationLayer) {
      this.maybeFetchConnectomeFiles();
    }
  }

  async maybeFetchConnectomeFiles() {
    const {
      dataset,
      segmentationLayer,
      availableConnectomeFiles,
      currentConnectomeFile,
      pendingConnectomeFileName,
    } = this.props;
    // If availableConnectomeFiles is not null, they have already been fetched
    if (segmentationLayer == null || availableConnectomeFiles != null) return;
    const connectomeFiles = await getConnectomeFilesForDatasetLayer(
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(segmentationLayer),
    );
    const layerName = segmentationLayer.name;
    Store.dispatch(updateConnectomeFileListAction(layerName, connectomeFiles));

    if (currentConnectomeFile == null && connectomeFiles.length > 0) {
      // If there was a pending connectome file name, use it, otherwise select the first one
      const connectomeFileName =
        pendingConnectomeFileName != null
          ? pendingConnectomeFileName
          : connectomeFiles[0].connectomeFileName;
      Store.dispatch(updateCurrentConnectomeFileAction(layerName, connectomeFileName));
    }
  }

  handleConnectomeFileSelected = async (connectomeFileName: string | null | undefined) => {
    const { segmentationLayer } = this.props;

    if (segmentationLayer != null && connectomeFileName != null) {
      Store.dispatch(updateCurrentConnectomeFileAction(segmentationLayer.name, connectomeFileName));
    }
  };

  updateParticleSize = (value: number) => {
    Store.dispatch(updateUserSettingAction("particleSize", value));
  };

  getConnectomeFileSettings = () => {
    const { currentConnectomeFile, availableConnectomeFiles, particleSize } = this.props;
    const currentConnectomeFileName =
      currentConnectomeFile != null ? currentConnectomeFile.connectomeFileName : null;
    return (
      <>
        <Row
          style={{
            width: 350,
          }}
        >
          <Col span={9}>
            <label className="setting-label">Connectome File</label>
          </Col>
          <Col span={15}>
            <Tooltip
              title="Select a connectome file from which synapses will be loaded."
              placement="top"
            >
              <Select
                placeholder="Select a connectome file"
                value={currentConnectomeFileName}
                onChange={this.handleConnectomeFileSelected}
                size="small"
                loading={availableConnectomeFiles == null}
                style={{
                  width: "100%",
                }}
              >
                {availableConnectomeFiles?.length ? (
                  availableConnectomeFiles.map((connectomeFile) => (
                    <Option
                      key={connectomeFile.connectomeFileName}
                      value={connectomeFile.connectomeFileName}
                    >
                      {connectomeFile.connectomeFileName}
                    </Option>
                  ))
                ) : (
                  <Option value={null} disabled>
                    No files available
                  </Option>
                )}
              </Select>
            </Tooltip>
          </Col>
        </Row>
        <Row
          style={{
            width: 350,
          }}
        >
          <Col span={24}>
            <NumberSliderSetting
              label={settings.particleSize}
              min={userSettings.particleSize.minimum}
              max={userSettings.particleSize.maximum}
              step={0.1}
              value={particleSize}
              onChange={this.updateParticleSize}
              defaultValue={defaultState.userConfiguration.particleSize}
            />
          </Col>
        </Row>
      </>
    );
  };

  render() {
    return (
      <Tooltip title="Configure Connectome Settings">
        <Popover content={this.getConnectomeFileSettings} trigger="click" placement="bottomRight">
          <ButtonComponent>
            <SettingOutlined />
          </ButtonComponent>
        </Popover>
      </Tooltip>
    );
  }
}

const connector = connect(mapStateToProps);
export default connector(ConnectomeFilters);
