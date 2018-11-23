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
import constants, { type Mode } from "oxalis/constants";
import message from "messages";

type Props = {
  flycam: Flycam,
  viewMode: Mode,
};

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

  handleChangePosition = position => {
    Store.dispatch(setPositionAction(position));
  };

  handleChangeRotation = rotation => {
    Store.dispatch(setRotationAction(rotation));
  };

  render() {
    const position = V3.floor(getPosition(this.props.flycam));
    const rotation = V3.round(getRotation(this.props.flycam));
    const isArbitraryMode = constants.MODES_ARBITRARY.includes(this.props.viewMode);

    return (
      <div>
        <Tooltip title={message["tracing.copy_position"]} placement="bottomLeft">
          <div>
            <Input.Group compact>
              <ButtonComponent onClick={this.copyPositionToClipboard}>
                <Icon type="pushpin" style={{ transform: "rotate(45deg)" }} />
              </ButtonComponent>
              <Vector3Input
                value={position}
                onChange={this.handleChangePosition}
                // The input field should be able to show at least xxxxx, yyyyy, zzzzz
                // without scrolling
                style={{ maxWidth: 140, textAlign: "center" }}
              />
            </Input.Group>
          </div>
        </Tooltip>
        {isArbitraryMode ? (
          <Tooltip title={message["tracing.copy_rotation"]} placement="bottomLeft">
            <div style={{ marginLeft: 10 }}>
              <Input.Group compact>
                <ButtonComponent onClick={this.copyRotationToClipboard}>
                  <Icon type="reload" />
                </ButtonComponent>
                <Vector3Input
                  value={rotation}
                  onChange={this.handleChangeRotation}
                  style={{ width: 100 }}
                />
              </Input.Group>
            </div>
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

export default connect(mapStateToProps)(DatasetPositionView);
