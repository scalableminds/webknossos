// @flow
import React, { Component } from "react";
import type Model from "oxalis/model";
import Constants, { OrthoViews } from "oxalis/constants";
import Store from "oxalis/store";
import { createNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import { getPosition, getRotationOrtho, getIntegerZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { Button } from "antd";

class SkeletonActionsView extends Component {
  props: {
    oldModel: Model,
  };

  componentDidMount() {
    this.props.oldModel.on("change:mode", this._forceUpdate);
  }

  componentWillUnmount() {
    this.props.oldModel.off("change:mode", this._forceUpdate);
  }

  _forceUpdate = () => { this.forceUpdate(); };

  handleAddNode = () => {
    // add node
    Store.dispatch(createNodeAction(
      getPosition(Store.getState().flycam),
      getRotationOrtho(OrthoViews.PLANE_XY),
      0, // legacy for OrthoViews.PLANE_XY
      getIntegerZoomStep(Store.getState()),
    ));
  }

  render() {
    if (this.props.oldModel.mode === Constants.MODE_PLANE_TRACING) {
      return (
        <div>
          <Button
            type="button"
            icon="plus"
            onClick={this.handleAddNode}
          >Add Node (Right-Click)</Button>
        </div>
      );
    }
    return null;
  }
}

export default SkeletonActionsView;
