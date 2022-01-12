// @flow
import { Popover, Select, Tooltip, Row, Col } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import React from "react";

import type { APISegmentationLayer, APIConnectomeFile, APIDataset } from "types/api_flow_types";
import Store, { type OxalisState } from "oxalis/store";
import ButtonComponent from "oxalis/view/components/button_component";
import { getConnectomeFilesForDatasetLayer } from "admin/admin_rest_api";
import {
  updateConnectomeFileListAction,
  updateCurrentConnectomeFileAction,
} from "oxalis/model/actions/connectome_actions";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";

const { Option } = Select;

type OwnProps = {|
  segmentationLayer: ?APISegmentationLayer,
|};

type StateProps = {|
  dataset: APIDataset,
  availableConnectomeFiles: ?Array<APIConnectomeFile>,
  currentConnectomeFile: ?APIConnectomeFile,
  prendingConnectomeFileName: ?string,
|};

type Props = {| ...OwnProps, ...StateProps |};

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
    prendingConnectomeFileName:
      connectomeData != null ? connectomeData.prendingConnectomeFileName : null,
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
      prendingConnectomeFileName,
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
        prendingConnectomeFileName != null
          ? prendingConnectomeFileName
          : connectomeFiles[0].connectomeFileName;
      Store.dispatch(updateCurrentConnectomeFileAction(layerName, connectomeFileName));
    }
  }

  handleConnectomeFileSelected = async (connectomeFileName: ?string) => {
    const { segmentationLayer } = this.props;
    if (segmentationLayer != null && connectomeFileName != null) {
      Store.dispatch(updateCurrentConnectomeFileAction(segmentationLayer.name, connectomeFileName));
    }
  };

  getConnectomeFileSettings = () => {
    const { currentConnectomeFile, availableConnectomeFiles } = this.props;
    const currentConnectomeFileName =
      currentConnectomeFile != null ? currentConnectomeFile.connectomeFileName : null;
    return (
      <Row style={{ width: 300 }}>
        <Col span={10}>
          <label className="setting-label">Connectome File</label>
        </Col>
        <Col span={14}>
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
              style={{ width: "100%" }}
            >
              {availableConnectomeFiles != null && availableConnectomeFiles.length ? (
                availableConnectomeFiles.map(connectomeFile => (
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

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(ConnectomeFilters);
