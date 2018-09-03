// @flow
import React, { PureComponent } from "react";
import constants from "oxalis/constants";
import type { ModeType } from "oxalis/constants";
import { Menu, Radio, Icon, Dropdown } from "antd";
import { setViewModeAction } from "oxalis/model/actions/settings_actions";
import type { OxalisState, AllowedModeType } from "oxalis/store";
import Store from "oxalis/store";
import { connect } from "react-redux";
import * as Utils from "libs/utils";

type Props = {
  viewMode: ModeType,
  allowedModes: Array<AllowedModeType>,
};

type State = {
  arbitraryModeLabel: ModeType,
};

class ViewModesView extends PureComponent<Props, State> {
  constructor() {
    super();
    this.state = {
      arbitraryModeLabel: constants.MODE_ARBITRARY,
    };
  }

  componentWillReceiveProps(nextProps: Props) {
    if (nextProps.viewMode !== constants.MODE_PLANE_TRACING) {
      this.setState({
        arbitraryModeLabel: nextProps.viewMode,
      });
    }
  }

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
    const arbitraryMenu = (
      <Menu
        selectedKeys={[this.props.viewMode]}
        onClick={({ key }) => Store.dispatch(setViewModeAction(key))}
      >
        <Menu.Item key={constants.MODE_ARBITRARY}>Flight</Menu.Item>
        <Menu.Item key={constants.MODE_ARBITRARY_PLANE}>Oblique</Menu.Item>
      </Menu>
    );

    const viewMode = this.props.viewMode;

    return (
      <Radio.Group onChange={this.handleChange} value={viewMode}>
        <Radio.Button
          onClick={this.blurElement}
          key={constants.MODE_PLANE_TRACING}
          disabled={this.isDisabled(constants.MODE_PLANE_TRACING)}
          value={constants.MODE_PLANE_TRACING}
        >
          {Utils.capitalize(constants.MODE_PLANE_TRACING)}
        </Radio.Button>
        <Dropdown key="arbitrary" overlay={arbitraryMenu}>
          <Radio.Button
            onClick={this.blurElement}
            key={this.state.arbitraryModeLabel}
            disabled={this.isDisabled(this.state.arbitraryModeLabel)}
            value={this.state.arbitraryModeLabel}
            style={{ paddingRight: 0 }}
          >
            {Utils.capitalize(this.state.arbitraryModeLabel)} <Icon type="down" />
          </Radio.Button>
        </Dropdown>
      </Radio.Group>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    allowedModes: state.tracing.restrictions.allowedModes,
  };
}

export default connect(mapStateToProps)(ViewModesView);
