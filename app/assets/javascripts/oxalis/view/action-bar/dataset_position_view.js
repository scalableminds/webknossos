// @flow
import React, { PureComponent } from "react";
import type { OxalisState, FlycamType } from "oxalis/store";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import constants from "oxalis/constants";
import Toast from "libs/toast";
import { V3 } from "libs/mjs";
import Store from "oxalis/store";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import { Button, Input } from "antd";
import Vector3Input from "libs/vector3_input";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";

class DatasetPositionView extends PureComponent {
  props: {
    flycam: FlycamType,
  };

  unsubscribeFunction: () => void;

  componentDidMount() {
    this.unsubscribeFunction = listenToStoreProperty(
      storeState => storeState.viewMode,
      () => this._forceUpdate(),
    );
  }

  componentWillUnmount() {
    this.unsubscribeFunction();
  }

  _forceUpdate = () => { this.forceUpdate(); };

  copyPositionToClipboard = async () => {
    const position = V3.floor(getPosition(this.props.flycam)).join(", ");
    await Clipboard.copy(position);
    Toast.success("Position copied to clipboard");
  };

  copyRotationToClipboard = async () => {
    const rotation = V3.round(getRotation(this.props.flycam)).join(", ");
    await Clipboard.copy(rotation);
    Toast.success("Rotation copied to clipboard");
  };

  handleChangePosition = (position) => {
    Store.dispatch(setPositionAction(position));
  };

  handleChangeRotation = (rotation) => {
    Store.dispatch(setRotationAction(rotation));
  };

  render() {
    const position = V3.floor(getPosition(this.props.flycam));
    const rotation = V3.round(getRotation(this.props.flycam));
    const viewMode = Store.getState().viewMode;
    const isArbitraryMode = constants.MODES_ARBITRARY.includes(viewMode);

    return (
      <div>
        <div>
          <Input.Group compact size="large">
            <Button
              onClick={this.copyPositionToClipboard}
              size="large"
            >Position</Button>
            <Vector3Input
              value={position}
              onChange={this.handleChangePosition}
              style={{ width: "120px" }}
            />
          </Input.Group>
        </div>
        <div>
          {
            isArbitraryMode ?
              <Input.Group compact size="large">
                <Button
                  onClick={this.copyRotationToClipboard}
                  size="large"
                >Rotation</Button>
                <Vector3Input
                  value={rotation}
                  onChange={this.handleChangeRotation}
                  style={{ width: "120px" }}
                />
              </Input.Group> : null
          }
        </div>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    flycam: state.flycam,
  };
}

export default connect(mapStateToProps)(DatasetPositionView);
