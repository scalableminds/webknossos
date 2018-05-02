/**
 * mapping_info_view.js
 * @flow
 */
import React, { Component } from "react";
import { connect } from "react-redux";
import Cube from "oxalis/model/binary/data_cube";
import Model from "oxalis/model";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { SwitchSetting } from "oxalis/view/settings/setting_input_views";
import type { Vector3 } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";
import _ from "lodash";

type Props = {
  position: Vector3,
  isMappingEnabled: boolean,
};

class MappingInfoView extends Component<Props> {
  componentDidMount() {
    const cube = this.getCube();
    cube.on("bucketLoaded", this._forceUpdate);
    cube.on("volumeLabeled", this._forceUpdate);
    cube.on("newMapping", this._forceUpdate);
  }

  componentWillUnmount() {
    const cube = this.getCube();
    cube.off("bucketLoaded", this._forceUpdate);
    cube.off("volumeLabeled", this._forceUpdate);
    cube.off("newMapping", this._forceUpdate);
  }

  _forceUpdate = _.throttle(() => {
    this.forceUpdate();
  }, 100);

  getCube(): Cube {
    return Model.getSegmentationBinary().cube;
  }

  handleChangeMappingEnabled = (isEnabled: boolean) => {
    this.getCube().setMappingEnabled(isEnabled);
  };

  render() {
    const cube = this.getCube();
    const hasMapping = cube.hasMapping();
    const idWithMapping = cube.getDataValue(this.props.position, cube.mapping);
    const idWithoutMapping = cube.getDataValue(this.props.position, null);

    return (
      <div id="volume-mapping-info">
        <div className="well">
          {hasMapping ? (
            <div>
              <p>ID without mapping: {idWithoutMapping}</p>
              <p>ID with mapping: {idWithMapping}</p>
            </div>
          ) : (
            <p>ID at current position: {idWithoutMapping}</p>
          )}
        </div>
        {hasMapping ? (
          <div>
            <SwitchSetting
              value={this.props.isMappingEnabled}
              onChange={this.handleChangeMappingEnabled}
              label="Enable Mapping"
            />
          </div>
        ) : null}
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    position: getPosition(state.flycam),
    isMappingEnabled: state.temporaryConfiguration.isMappingEnabled,
  };
}

export default connect(mapStateToProps)(MappingInfoView);
