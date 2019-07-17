// @flow
import { Input, Tooltip, Icon } from "antd";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import React, { PureComponent } from "react";

import { V3 } from "libs/mjs";
import { Vector3Input } from "libs/vector_input";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import Store, { type OxalisState, type Flycam } from "oxalis/store";
import Toast from "libs/toast";
import constants, { type ViewMode, type Vector3 } from "oxalis/constants";
import message from "messages";

type Props = {|
  flycam: Flycam,
  viewMode: ViewMode,
|};

const positionIconStyle = { transform: "rotate(-45deg)" };

class DatasetPositionView extends PureComponent<Props> {
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

  handleChangePosition = (position: Vector3) => {
    Store.dispatch(setPositionAction(position));
  };

  handleChangeRotation = (rotation: Vector3) => {
    Store.dispatch(setRotationAction(rotation));
  };

  render() {
    const position = V3.floor(getPosition(this.props.flycam));
    const rotation = V3.round(getRotation(this.props.flycam));
    const isArbitraryMode = constants.MODES_ARBITRARY.includes(this.props.viewMode);

    return (
      <div style={{ display: "flex" }}>
        <Input.Group compact style={{ whiteSpace: "nowrap" }}>
          <Tooltip title={message["tracing.copy_position"]} placement="bottomLeft">
            <ButtonComponent
              onClick={this.copyPositionToClipboard}
              style={{ padding: "0 10px" }}
              className="hide-on-small-screen"
            >
              <Icon type="pushpin" style={positionIconStyle} />
            </ButtonComponent>
          </Tooltip>
          <Vector3Input
            value={position}
            onChange={this.handleChangePosition}
            autosize
            style={{ textAlign: "center" }}
          />
        </Input.Group>
        {isArbitraryMode ? (
          <Tooltip title={message["tracing.copy_rotation"]} placement="bottomLeft">
            <Input.Group compact style={{ whiteSpace: "nowrap", marginLeft: 10 }}>
              <ButtonComponent
                onClick={this.copyRotationToClipboard}
                style={{ padding: "0 10px" }}
                className="hide-on-small-screen"
              >
                <Icon type="reload" />
              </ButtonComponent>
              <Vector3Input
                value={rotation}
                onChange={this.handleChangeRotation}
                style={{ textAlign: "center", width: 120 }}
              />
            </Input.Group>
          </Tooltip>
        ) : null}
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    flycam: state.flycam,
    viewMode: state.temporaryConfiguration.viewMode,
  };
}

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(DatasetPositionView);
