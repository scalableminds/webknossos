// @flow
import React, { PureComponent } from "react";
import constants from "oxalis/constants";
import type { ModeType } from "oxalis/constants";
import { Radio } from "antd";
import { setViewModeAction } from "oxalis/model/actions/settings_actions";
import type { OxalisState, AllowedModeType } from "oxalis/store";
import Store from "oxalis/store";
import { connect } from "react-redux";
import Utils from "libs/utils";

type Props = {
  viewMode: ModeType,
  allowedModes: Array<AllowedModeType>,
};

class ViewModesView extends PureComponent<Props> {
  blurElement = (event: SyntheticInputEvent<>) => {
    event.target.blur();
  };

  handleChange = (event: { target: { value: ModeType } }) => {
    Store.dispatch(setViewModeAction(event.target.value));
  };

  isDisabled(mode: ModeType) {
    return !this.props.allowedModes.includes(mode);
  }

  render() {
    const viewMode = this.props.viewMode;
    return (
      <Radio.Group onChange={this.handleChange} value={viewMode} size="large">
        {constants.MODES_SKELETON.map(mode =>
          <Radio.Button
            onClick={this.blurElement}
            key={mode}
            disabled={this.isDisabled(mode)}
            value={mode}
          >
            {Utils.capitalize(mode)}
          </Radio.Button>,
        )}
      </Radio.Group>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    allowedModes: state.tracing.restrictions.allowedModes,
  };
}

export default connect(mapStateToProps)(ViewModesView);
