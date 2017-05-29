// @flow
import React, { PureComponent } from "react";
import Model from "oxalis/model";
import Store from "oxalis/store";
import type { OxalisState, TracingType, TaskType } from "oxalis/store";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import app from "app";
import Constants from "oxalis/constants";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";
import { Button } from "antd";
import messages from "messages";
import createApi from "oxalis/api/api_latest";

const api = createApi(Model);
const SAVED_POLLING_INTERVAL = 100;

class DatasetActionsView extends PureComponent {
  props: {
    // eslint-disable-next-line react/no-unused-prop-types
    tracing: TracingType,
    // eslint-disable-next-line react/no-unused-prop-types
    dispatch: Dispatch<*>,
    task: ?TaskType,
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

  handleSave = async (event?: SyntheticInputEvent) => {
    if (event != null) {
      event.target.blur();
    }
    await Model.save();
  };

  handleCopyToAccount = async (event: SyntheticInputEvent) => {
    event.target.blur();
    const url = `/annotations/${this.props.tracing.tracingType}/${this.props.tracing.tracingId}/duplicate`;
    app.router.loadURL(url);
  };

  handleFinish = async (event: SyntheticInputEvent) => {
    event.target.blur();
    const url = `/annotations/${this.props.tracing.tracingType}/${this.props.tracing.tracingId}/finishAndRedirect`;
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

  handleDownload = async (event: SyntheticInputEvent) => {
    event.target.blur();
    const win = window.open("about:blank", "_blank");
    win.document.body.innerHTML = messages["download.wait"];
    await this.handleSave();

    win.location.href = Model.tracing.downloadUrl;
    win.document.body.innerHTML = messages["download.close_window"];
  };

  handleFinishAndGetNextTask = async (event: SyntheticInputEvent) => {
    event.target.blur();
    api.tracing.finishAndGetNextTask();
  };

  handleMergeOpen = () => {
    this.setState({ mergeModalOpen: true });
  };

  handleMergeClose = () => {
    this.setState({ mergeModalOpen: false });
  };

  getSaveButtonIcon() {
    if (!Model.stateSaved()) {
      return "hourglass";
    } else {
      return "check";
    }
  }

  render() {
    const viewMode = Store.getState().temporaryConfiguration.viewMode;
    const isSkeletonMode = Constants.MODES_SKELETON.includes(viewMode);
    const hasAdvancedOptions = this.props.tracing.restrictions.advancedOptionsAllowed;
    const archiveButtonText = this.props.task ? "Finish" : "Archive";
    const restrictions = this.props.tracing.restrictions;


    const elements = [];
    if (restrictions.allowUpdate) {
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
      if (restrictions.allowFinish) {
        elements.push(<Button
          key="finish-button"
          icon="check-circle-o"
          onClick={this.handleFinish}
        >{archiveButtonText}</Button>);
      }
      if (restrictions.allowDownload || !this.props.tracing.downloadUrl) {
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
    if (restrictions.allowFinish && this.props.task) {
      elements.push(<Button
        key="next-button"
        icon="verticle-left"
        onClick={this.handleFinishAndGetNextTask}
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
    task: state.task,
  };
}

export default connect(mapStateToProps)(DatasetActionsView);
