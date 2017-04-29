// @flow
import React, { PureComponent } from "react";
import constants from "oxalis/constants";
import type { ModeType } from "oxalis/constants";
import { Radio } from "antd";
import { setViewModeAction } from "oxalis/model/actions/skeletontracing_actions";
import Store from "oxalis/store";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";

class ViewModesView extends PureComponent {
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

  handleChange = (event: { target: { value: ModeType } }) => {
    Store.dispatch(setViewModeAction(event.target.value));
  };

  render() {
    const viewMode = Store.getState().viewMode;
    return (
      <Radio.Group onChange={this.handleChange} value={viewMode} size="large">
        <Radio.Button value={constants.MODE_PLANE_TRACING}>Orthogonal</Radio.Button>
        <Radio.Button value={constants.MODE_ARBITRARY}>Flight</Radio.Button>
        <Radio.Button value={constants.MODE_ARBITRARY_PLANE}>Oblique</Radio.Button>
      </Radio.Group>
    );
  }
}

export default ViewModesView;
