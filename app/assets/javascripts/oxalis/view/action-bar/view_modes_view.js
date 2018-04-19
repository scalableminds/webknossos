// @flow
import React, { PureComponent } from "react";
import constants from "oxalis/constants";
import type { ModeType } from "oxalis/constants";
import { Icon, Menu, Radio, Dropdown } from "antd";
import { setViewModeAction, setPlaneLayoutAction } from "oxalis/model/actions/settings_actions";
import type { OxalisState, AllowedModeType, PlaneLayoutType } from "oxalis/store";
import Store, { LayoutTypes } from "oxalis/store";
import { connect } from "react-redux";
import Utils from "libs/utils";

type Props = {
  viewMode: ModeType,
  allowedModes: Array<AllowedModeType>,
  activePlaneLayout: PlaneLayoutType,
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

    const menu = (
      <Menu
        selectedKeys={[this.props.activePlaneLayout]}
        onClick={({ key }) => Store.dispatch(setPlaneLayoutAction(key))}
      >
        <Menu.Item key={LayoutTypes[0]}>
          <Icon type="plus-square-o" /> Two rows, two columns
        </Menu.Item>
        <Menu.Item key={LayoutTypes[1]}>
          <Icon type="minus" /> One row, four columns
        </Menu.Item>
      </Menu>
    );

    return (
      <Radio.Group onChange={this.handleChange} value={viewMode}>
        {constants.MODES_SKELETON.map(
          mode =>
            mode === "orthogonal" && viewMode === mode ? (
              <Dropdown key={mode} overlay={menu}>
                <Radio.Button
                  onClick={this.blurElement}
                  key={mode}
                  disabled={this.isDisabled(mode)}
                  value={mode}
                  style={{ paddingRight: 0 }}
                >
                  {Utils.capitalize(mode)} <Icon type="down" />
                </Radio.Button>
              </Dropdown>
            ) : (
              <Radio.Button
                onClick={this.blurElement}
                key={mode}
                disabled={this.isDisabled(mode)}
                value={mode}
              >
                {Utils.capitalize(mode)}
              </Radio.Button>
            ),
        )}
      </Radio.Group>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    allowedModes: state.tracing.restrictions.allowedModes,
    activePlaneLayout: state.viewModeData.plane.activeLayout,
  };
}

export default connect(mapStateToProps)(ViewModesView);
