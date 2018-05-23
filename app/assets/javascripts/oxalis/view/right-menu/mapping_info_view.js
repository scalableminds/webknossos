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
import { setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import type { Vector3 } from "oxalis/constants";
import type { OxalisState, MappingType } from "oxalis/store";
import _ from "lodash";

type Props = {
  position: Vector3,
  isMappingEnabled: boolean,
  mapping: ?MappingType,
  setMappingEnabled: boolean => void,
};

class MappingInfoView extends Component<Props> {
  componentDidMount() {
    const cube = this.getSegmentationCube();
    cube.on("bucketLoaded", this._forceUpdate);
    cube.on("volumeLabeled", this._forceUpdate);
  }

  componentWillUnmount() {
    const cube = this.getSegmentationCube();
    cube.off("bucketLoaded", this._forceUpdate);
    cube.off("volumeLabeled", this._forceUpdate);
  }

  _forceUpdate = _.throttle(() => {
    this.forceUpdate();
  }, 100);

  getSegmentationCube(): Cube {
    return Model.getSegmentationBinary().cube;
  }

  render() {
    const cube = this.getSegmentationCube();
    const hasMapping = this.props.mapping != null;
    const idWithMapping = cube.getDataValue(this.props.position, this.props.mapping);
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
              onChange={this.props.setMappingEnabled}
              label="Enable Mapping"
            />
          </div>
        ) : null}
      </div>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setMappingEnabled(isEnabled) {
    dispatch(setMappingEnabledAction(isEnabled));
  },
});

function mapStateToProps(state: OxalisState) {
  return {
    position: getPosition(state.flycam),
    isMappingEnabled: state.temporaryConfiguration.activeMapping.isMappingEnabled,
    mapping: state.temporaryConfiguration.activeMapping.mapping,
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(MappingInfoView);
