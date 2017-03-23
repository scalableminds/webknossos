// @flow
import React, { Component } from "react";
import type Model from "oxalis/model";
import Constants from "oxalis/constants";
import classnames from "classnames";

class VolumeActionsView extends Component {
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

  render() {
    const isMoveMode = this.props.oldModel.volumeTracing.mode === Constants.VOLUME_MODE_MOVE;
    return (
      <div>
        <div className="btn-group">
          <button
            type="button"
            className={classnames("btn btn-default", { "btn-primary": isMoveMode })}
            onClick={() => { this.props.oldModel.volumeTracing.setMode(Constants.VOLUME_MODE_TRACE); }}
          >Move</button>
          <button
            type="button"
            className={classnames("btn btn-default", { "btn-primary": !isMoveMode })}
            onClick={() => { this.props.oldModel.volumeTracing.setMode(Constants.VOLUME_MODE_MOVE); }}
          >Trace</button>
        </div>
        <div className="btn-group">
          <button
            type="button"
            className="btn btn-default"
            onClick={() => { this.props.oldModel.volumeTracing.createCell(); }}
          >Create new cell (C)</button>
        </div>
      </div>
    );
  }
}

export default VolumeActionsView;
