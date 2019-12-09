/**
 * live_training_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { Icon, Select, Switch, Table, Tooltip } from "antd";
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
  isCurrentlyReapplying: boolean,
};

class LiveTrainingView extends React.Component<Props, State> {
  isMounted: boolean = false;

  state = {
    isCurrentlyReapplying: false,
  };

  componentDidMount() {
    this.isMounted = true;
  }

  componentWillUnmount() {
    this.isMounted = false;
  }

  render() {
    return "Hello World";


    # toggle to select class
    # train + predict button

    const availableMappings =
      this.props.segmentationLayer != null && this.props.segmentationLayer.mappings != null
        ? this.props.segmentationLayer.mappings
        : [];

    // Antd does not render the placeholder when a value is defined (even when it's null).
    // That's why, we only pass the value when it's actually defined.
    const selectValueProp =
      this.props.mappingName != null
        ? {
            value: this.props.mappingName,
          }
        : {};

    return (
      <div id="volume-mapping-info" className="padded-tab-content" style={{ maxWidth: 500 }}>
        {this.renderIdTable()}
        {/* Only display the mapping selection when merger mode is not active
            to avoid conflicts in the logic of the UI. */
        !this.props.isMergerModeEnabled ? (
          <div style={{ marginTop: 24, width: "50%", marginLeft: 16 }}>
            <div style={{ marginBottom: 6 }}>
              <label className="setting-label">
                ID Mapping
                <Switch
                  onChange={this.handleSetMappingEnabled}
                  checked={this.state.shouldMappingBeEnabled}
                  style={{ float: "right" }}
                  loading={this.state.isRefreshingMappingList}
                />
              </label>
            </div>

            {/*
            Show mapping-select even when the mapping is disabled but the UI was used before
            (i.e., mappingName != null)
          */}
            {this.state.shouldMappingBeEnabled || this.props.mappingName != null ? (
              <Select
                placeholder="Select mapping"
                defaultActiveFirstOption={false}
                style={{ width: "100%" }}
                {...selectValueProp}
                onChange={this.handleChangeMapping}
                notFoundContent="No mappings found."
              >
                {availableMappings
                  .slice()
                  .sort(Utils.localeCompareBy(([]: Array<string>), mapping => mapping))
                  .map(mapping => (
                    <Option key={mapping} value={mapping}>
                      {mapping}
                    </Option>
                  ))}
              </Select>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  });

function mapStateToProps(state: OxalisState) {
  return {

  };
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
