// @flow
import React, { PureComponent } from "react";
import Model from "oxalis/model";
import Store from "oxalis/store";
import type { OxalisState, TracingType, TaskType } from "oxalis/store";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import app from "app";
import { Button, Dropdown, Menu, Icon } from "antd";
import Constants from "oxalis/constants";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";
import ButtonComponent from "oxalis/view/components/button_component";
import messages from "messages";
import api from "oxalis/api/internal_api";

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
    isShareModalOpen: boolean,
    isMergeModalOpen: boolean,
  } = {
    isShareModalOpen: false,
    isMergeModalOpen: false,
  };

  componentDidMount() {
    this.savedPollingInterval = window.setInterval(this._forceUpdate, SAVED_POLLING_INTERVAL);
  }

  componentWillUnmount() {
    window.clearInterval(this.savedPollingInterval);
  }

  modalWrapper: ?HTMLDivElement = null;
  savedPollingInterval: number = 0;
  _forceUpdate = () => {
    this.forceUpdate();
  };

  handleSave = async (event?: SyntheticInputEvent) => {
    if (event != null) {
      event.target.blur();
    }
    await Model.save();
  };

  handleCopyToAccount = async (event: SyntheticInputEvent) => {
    event.target.blur();
    const url = `/annotations/${this.props.tracing.tracingType}/${this.props.tracing
      .tracingId}/duplicate`;
    app.router.loadURL(url);
  };

  handleFinish = async (event: SyntheticInputEvent) => {
    event.target.blur();
    const url = `/annotations/${this.props.tracing.tracingType}/${this.props.tracing
      .tracingId}/finishAndRedirect`;
    await this.handleSave();
    if (confirm(messages["finish.confirm"])) {
      app.router.loadURL(url);
    }
  };

  handleShareOpen = () => {
    this.setState({ isShareModalOpen: true });
  };

  handleShareClose = () => {
    this.setState({ isShareModalOpen: false });
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
    this.setState({ isMergeModalOpen: true });
  };

  handleMergeClose = () => {
    this.setState({ isMergeModalOpen: false });
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

    const saveButton = restrictions.allowUpdate
      ? <ButtonComponent
          key="save-button"
          type="primary"
          onClick={this.handleSave}
          icon={this.getSaveButtonIcon()}
        >
          Save
        </ButtonComponent>
      : [
          <ButtonComponent key="read-only-button" type="primary" disabled>
            Read only
          </ButtonComponent>,
          <ButtonComponent key="copy-button" icon="file-add" onClick={this.handleCopyToAccount}>
            Copy To My Account
          </ButtonComponent>,
        ];

    const finishAndNextTaskButton =
      hasAdvancedOptions && restrictions.allowFinish && this.props.task
        ? <ButtonComponent
            key="next-button"
            icon="verticle-left"
            onClick={this.handleFinishAndGetNextTask}
          >
            Finish and Get Next Task
          </ButtonComponent>
        : null;

    const elements = [];
    const modals = [];
    if (hasAdvancedOptions) {
      if (restrictions.allowFinish) {
        elements.push(
          <Menu.Item key="finish-button">
            <div onClick={this.handleFinish}>
              <Icon type="check-circle-o" />
              {archiveButtonText}
            </div>
          </Menu.Item>,
        );
      }
      if (restrictions.allowDownload || !this.props.tracing.downloadUrl) {
        elements.push(
          <Menu.Item key="download-button">
            <div onClick={this.handleDownload}>
              <Icon type="download" />
              Download
            </div>
          </Menu.Item>,
        );
      }
      elements.push(
        <Menu.Item key="share-button">
          <div onClick={this.handleShareOpen}>
            <Icon type="share-alt" />
            Share
          </div>
        </Menu.Item>,
      );
      modals.push(
        <ShareModalView
          key="share-modal"
          isVisible={this.state.isShareModalOpen}
          onOk={this.handleShareClose}
        />,
      );
    }

    if (isSkeletonMode) {
      elements.push(
        <Menu.Item key="merge-button">
          <div onClick={this.handleMergeOpen}>
            <Icon type="folder-open" />
            Merge Tracing
          </div>
        </Menu.Item>,
      );
      modals.push(
        <MergeModalView
          key="merge-modal"
          isVisible={this.state.isMergeModalOpen}
          onOk={this.handleMergeClose}
        />,
      );
    }

    const menu = (
      <Menu>
        {elements}
      </Menu>
    );

    return (
      <div>
        <Button.Group size="large">
          {saveButton}
          {finishAndNextTaskButton}
          {modals}
          <Dropdown overlay={menu}>
            <ButtonComponent>
              <Icon type="down" />
            </ButtonComponent>
          </Dropdown>
        </Button.Group>
      </div>
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
