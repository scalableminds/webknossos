// @flow
import React, { PureComponent } from "react";
import _ from "lodash";
import type Model from "oxalis/model";
import type { OxalisState, TracingType } from "oxalis/store";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import app from "app";
import Utils from "libs/utils";
import Request from "libs/request";
import Constants from "oxalis/constants";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";
import { Button } from "antd";
import messages from "messages";

const SAVED_POLLING_INTERVAL = 100;

class DatasetActionsView extends PureComponent {
  props: {
    // eslint-disable-next-line react/no-unused-prop-types
    tracing: TracingType,
    oldModel: Model,
    // eslint-disable-next-line react/no-unused-prop-types
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
    await this.props.oldModel.save();
  };

  handleCopyToAccount = async () => {
    const url = `/annotations/${this.props.oldModel.tracingType}/${this.props.oldModel.tracingId}/duplicate`;
    app.router.loadURL(url);
  };

  handleCopyToAccount = async () => {
    const url = `/annotations/${this.props.oldModel.tracingType}/${this.props.oldModel.tracingId}/duplicate`;
    app.router.loadURL(url);
  };

  handleFinish = async () => {
    const url = `/annotations/${this.props.oldModel.tracingType}/${this.props.oldModel.tracingId}/finishAndRedirect`;
    await this.handleSave();
    if (confirm(messages["finish.confirm"])) {
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
    win.document.body.innerHTML = messages["download.wait"];
    await this.handleSave();

    win.location.href = this.props.oldModel.tracing.downloadUrl;
    win.document.body.innerHTML = messages["download.close_window"];
  };

  handleNextTask = async () => {
    const { tracingType, tracingId } = this.props.tracing;
    const finishUrl = `/annotations/${tracingType}/${tracingId}/finish`;
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
    if (!this.props.oldModel.stateSaved()) {
      return "hourglass";
    } else {
      return "check";
    }
  }

  render() {
    const isSkeletonMode = _.includes(Constants.MODES_SKELETON, this.props.oldModel.get("mode"));
    const hasAdvancedOptions = this.props.oldModel.settings.advancedOptionsAllowed;
    const archiveButtonText = this.props.oldModel.get("isTask") ? "Finish" : "Archive";
    const { tracing } = this.props.oldModel;


    const elements = [];
    if (tracing.restrictions.allowUpdate) {
      elements.push(
        <Button
          key="save-button"
          type="primary"
          onClick={this.handleSave}
          icon={this.getSaveButtonIcon()}
        >Save</Button>);
    } else {
      elements.push(<Button
        key="read-only-button"
        type="primary"
        disabled
      >Read only</Button>);
      elements.push(<Button
        key="copy-button"
        icon="file-add"
        onClick={this.handleCopyToAccount}
      >Copy To My Account</Button>);
    }

    if (hasAdvancedOptions) {
      if (tracing.restrictions.allowFinish) {
        elements.push(<Button
          key="finish-button"
          icon="check-circle-o"
          onClick={this.handleFinish}
        >{archiveButtonText}</Button>);
      }
      if (tracing.restrictions.allowDownload || !tracing.downloadUrl) {
        elements.push(<Button
          key="download-button"
          icon="download"
          onClick={this.handleDownload}
        >Download</Button>);
      }
      elements.push(<Button
        key="share-button"
        icon="share-alt"
        onClick={this.handleShareOpen}
      >Share</Button>);
      elements.push(<ShareModalView
        key="share-modal"
        isVisible={this.state.shareModalOpen}
        onOk={this.handleShareClose}
      />);
    }
    if (tracing.restrictions.allowFinish && tracing.task) {
      elements.push(<Button
        key="next-button"
        icon="verticle-left"
        onClick={this.handleNextTask}
      >
        Finish and Get Next Task
      </Button>);
    }
    if (isSkeletonMode) {
      elements.push(
        <Button
          key="merge-button"
          icon="folder-open"
          onClick={this.handleMergeOpen}
        >Merge Tracing</Button>);
      elements.push(<MergeModalView
        key="merge-modal"
        isVisible={this.state.mergeModalOpen}
        onOk={this.handleMergeClose}
      />);
    }

    return (
      <div><Button.Group size="large">{elements}</Button.Group></div>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    tracing: state.tracing,
    save: state.save,
  };
}

export default connect(mapStateToProps)(DatasetActionsView);
