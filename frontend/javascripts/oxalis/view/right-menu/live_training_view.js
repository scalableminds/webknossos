/**
 * live_training_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { Icon, Select, Switch, Table, Tooltip, Radio, Button, Progress } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import debounceRender from "react-debounce-render";

import createProgressCallback from "libs/progress_callback";
import type { APIDataset, APISegmentationLayer } from "admin/api_flow_types";
import { type OrthoView, OrthoViews, type Vector2, type Vector3 } from "oxalis/constants";
import type { OxalisState, Mapping } from "oxalis/store";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getMappingsForDatasetLayer } from "admin/admin_rest_api";
import { getPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setLayerMappingsAction } from "oxalis/model/actions/dataset_actions";
import { setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import Model from "oxalis/model";
import message from "messages";
import * as Utils from "libs/utils";

const { Option } = Select;

type OwnProps = {|
  portalKey: string,
|};
type StateProps = {|
  // TODO
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  currentLabel: string,
  isRetraining: boolean,
};

class LiveTrainingView extends React.Component<Props, State> {
  isMounted: boolean = false;

  state = {
    currentLabel: "foreground",
    isRetraining: false,
  };

  componentDidMount() {
    this.isMounted = true;
  }

  componentWillUnmount() {
    this.isMounted = false;
  }

  render() {
    return (
      <div id="live-training" className="padded-tab-content" style={{ maxWidth: 500 }}>
        <div style={{ marginBottom: 6 }}>
          <label className="setting-label">
            Brush to label…
            <Radio.Group
              value={this.state.currentLabel}
              onChange={this.handleChangeLabel}
              style={{ marginLeft: 6 }}
            >
              <Radio.Button value="foreground">Foreground</Radio.Button>
              <Radio.Button value="background">Background</Radio.Button>
            </Radio.Group>
          </label>
        </div>

        <Button type="primary">Retrain and Predict</Button>
        <div style={{ display: "block", marginTop: 6 }}>
          <Progress type="circle" percent={70} />
        </div>
      </div>
    );

    // train + predict button
  }

  handleChangeLabel = (changeEvent: event): void => {
    this.setState({ currentLabel: changeEvent.target.value });
  };
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({});

function mapStateToProps(state: OxalisState) {
  return {};
}

const debounceTime = 100;
export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
  null,
  {
    pure: false,
  },
)(debounceRender(LiveTrainingView, debounceTime));
