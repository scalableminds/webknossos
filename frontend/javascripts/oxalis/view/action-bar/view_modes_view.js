// @flow
import { Dropdown, Icon, Menu, Radio, Select } from "antd";
import { connect } from "react-redux";
import React, { PureComponent } from "react";

import { setViewModeAction } from "oxalis/model/actions/settings_actions";
import Store, { type OxalisState, type AllowedMode } from "oxalis/store";
import * as Utils from "libs/utils";
import constants, { type ViewMode } from "oxalis/constants";

const Option = Select.Option;

type Props = {|
  viewMode: ViewMode,
  allowedModes: Array<AllowedMode>,
|};

class ViewModesView extends PureComponent<Props, {}> {
  blurElement = (event: SyntheticInputEvent<>) => {
    event.target.blur();
  };

  handleChange = (mode: ViewMode) => {
    Store.dispatch(setViewModeAction(mode));
  };

  isDisabled(mode: ViewMode) {
    return !this.props.allowedModes.includes(mode);
  }

  render() {
    // todo ?
    // onClick={this.blurElement}
    return (
      <Select
        value={this.props.viewMode}
        style={{ width: 120 }}
        onChange={this.handleChange}
        onClick={({ key }) => Store.dispatch(setViewModeAction(key))}
      >
        {[
          constants.MODE_PLANE_TRACING,
          constants.MODE_ARBITRARY,
          constants.MODE_ARBITRARY_PLANE,
        ].map(mode => (
          <Option key={mode} disabled={this.isDisabled(mode)} value={mode}>
            {Utils.capitalize(mode)}
          </Option>
        ))}
      </Select>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    allowedModes: state.tracing.restrictions.allowedModes,
  };
}

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(ViewModesView);
