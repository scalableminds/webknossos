// @flow
import React, { Component } from "react";
import _ from "lodash";
import type Model from "oxalis/model";
import type { OxalisState, SkeletonTracingType, SaveStateType } from "oxalis/store";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import app from "app";
import Utils from "libs/utils";
import Request from "libs/request";
import Constants from "oxalis/constants";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import { Button } from "antd";

const SAVED_POLLING_INTERVAL = 100;

class DatasetActionsView extends Component {
  props: {
    skeletonTracing: SkeletonTracingType,
    save: SaveStateType,
    oldModel: Model,
    dispatch: Dispatch<*>,
  };

  state: {
    shareModalOpen: boolean,
    mergeModalOpen: boolean,
  } = {
    shareModalOpen: false,
    mergeModalOpen: false,
  }

  componentDidMount() {
    this.savedPollingInterval = window.setInterval(this._forceUpdate, SAVED_POLLING_INTERVAL);
  }

  componentWillUnmount() {
    window.clearInterval(this.savedPollingInterval);
  }

  modalWrapper: ?HTMLDivElement = null;
  savedPollingInterval: number = 0;
  _forceUpdate = () => { this.forceUpdate(); };

  handleSave = async () => {
    if (this.props.oldModel.volumeTracing != null) {
      this.props.dispatch(saveNowAction());
      return;
    }
    this.props.dispatch(saveNowAction());
    let saveState = this.props.save;
    while (saveState.isBusy || saveState.queue.length > 0) {
      await Utils.sleep(500);
      saveState = this.props.save;
    }
  };

  handleFinish = async () => {
    const url = `/annotations/${this.props.oldModel.tracingType}/${this.props.oldModel.tracingId}/finishAndRedirect`;
    await this.handleSave();
    if (confirm("Are you sure you want to permanently finish this tracing?")) {
      app.router.loadURL(url);
    }
  };

  handleShareOpen = () => {
    this.setState({ shareModalOpen: true });
  };

  handleShareClose = () => {
    this.setState({ shareModalOpen: false });
  };

  handleDownload = async () => {
    const win = window.open("about:blank", "_blank");
    win.document.body.innerHTML = "Please wait...";
    await this.handleSave();

    win.location.href = this.props.oldModel.tracing.downloadUrl;
    win.document.body.innerHTML = "You may close this window after the download has started.";
  };

  handleNextTask = async () => {
    const { tracingType, id } = this.props.skeletonTracing;
    const finishUrl = `/annotations/${tracingType}/${id}/finish`;
    const requestTaskUrl = "/user/tasks/request";

    await this.handleSave();
    await Request.triggerRequest(finishUrl);
    try {
      const annotation = await Request.receiveJSON(requestTaskUrl);
      const differentTaskType = annotation.task.type.id !== Utils.__guard__(this.props.oldModel.tracing.task, x => x.type.id);
      const differentTaskTypeParam = differentTaskType ? "?differentTaskType" : "";
      const newTaskUrl = `/annotations/${annotation.typ}/${annotation.id}${differentTaskTypeParam}`;
      app.router.loadURL(newTaskUrl);
    } catch (err) {
      await Utils.sleep(2000);
      app.router.loadURL("/dashboard");
    }
  };

  handleMergeOpen = () => {
    this.setState({ mergeModalOpen: true });
  };

  handleMergeClose = () => {
    this.setState({ mergeModalOpen: false });
  };

  getSaveButtonIcon() {
    const { save: saveState } = this.props;
    const stateSaved =
      this.props.oldModel.volumeTracing != null ?
      this.props.oldModel.annotationModel.stateLogger.stateSaved() :
      !saveState.isBusy && !(saveState.queue.length > 0);
    if (!stateSaved) {
      return "hourglass";
    } else {
      return "check";
    }
  }

  render() {
    const isSkeletonMode = _.includes(Constants.MODES_SKELETON, this.props.oldModel.get("mode"));
    const hasAdvancedOptions = this.props.oldModel.settings.advancedOptionsAllowed;
    const archiveButtonText = this.isTask ? "Finish" : "Archive";
    const { tracing } = this.props.oldModel;

    const elements = [];
    if (tracing.restrictions.allowUpdate) {
      elements.push(
        <Button
          type="primary"
          onClick={this.handleSave}
          icon={this.getSaveButtonIcon()}
        >Save</Button>);
    } else {
      elements.push(<Button type="primary" disabled>Read only</Button>);
    }

    if (hasAdvancedOptions) {
      if (tracing.restrictions.allowFinish) {
        elements.push(<Button
          icon="check-circle-o"
          onClick={this.handleFinish}
        >{archiveButtonText}</Button>);
      }
      if (tracing.restrictions.allowDownload || !tracing.downloadUrl) {
        elements.push(<Button
          icon="download"
          onClick={this.handleDownload}
        >Download</Button>);
      }
      elements.push(<Button
        icon="share-alt"
        onClick={this.handleShareOpen}
      >Share</Button>);
      elements.push(<ShareModalView
        isVisible={this.state.shareModalOpen}
        onOk={this.handleShareClose}
      />);
    }
    if (tracing.restrictions.allowFinish && tracing.task) {
      elements.push(<Button
        icon="verticle-left"
        onClick={this.handleNextTask}
      >
        Finish and Get Next Task
      </Button>);
    }
    if (isSkeletonMode) {
      elements.push(
        <Button
          icon="folder-open"
          onClick={this.handleMergeOpen}
        >Merge Tracing</Button>);
      elements.push(<MergeModalView
        isVisible={this.state.mergeModalOpen}
        onOk={this.handleMergeClose}
      />);
    }

    return (
      <div><Button.Group>{elements}</Button.Group></div>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    skeletonTracing: state.skeletonTracing,
    save: state.save,
  };
}

export default connect(mapStateToProps)(DatasetActionsView);
