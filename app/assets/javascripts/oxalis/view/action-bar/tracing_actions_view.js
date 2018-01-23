// @flow
import React, { PureComponent } from "react";
import Model from "oxalis/model";
import Store from "oxalis/store";
import { connect } from "react-redux";
import { Button, Dropdown, Menu, Icon, Modal } from "antd";
import Constants from "oxalis/constants";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";
import UserScriptsModalView from "oxalis/view/action-bar/user_scripts_modal_view";
import SaveButton from "oxalis/view/action-bar/save_button";
import ButtonComponent from "oxalis/view/components/button_component";
import messages from "messages";
import api from "oxalis/api/internal_api";
import { undoAction, redoAction } from "oxalis/model/actions/save_actions";
import { copyAnnotationToUserAccount } from "admin/admin_rest_api";
import { location } from "libs/window";
import type { OxalisState, RestrictionsType, SettingsType, TaskType } from "oxalis/store";
import type { APIUserType } from "admin/api_flow_types";

type StateProps = {
  tracingType: string,
  annotationId: string,
  restrictions: RestrictionsType & SettingsType,
  task: ?TaskType,
  activeUser: ?APIUserType,
};

type State = {
  isShareModalOpen: boolean,
  isMergeModalOpen: boolean,
  isUserScriptsModalOpen: boolean,
};

class TracingActionsView extends PureComponent<StateProps, State> {
  state = {
    isShareModalOpen: false,
    isMergeModalOpen: false,
    isUserScriptsModalOpen: false,
  };

  modalWrapper: ?HTMLDivElement = null;

  handleSave = async (event?: SyntheticInputEvent<>) => {
    if (event != null) {
      event.target.blur();
    }
    await Model.save();
  };

  handleUndo = () => {
    Store.dispatch(undoAction());
  };

  handleRedo = () => {
    Store.dispatch(redoAction());
  };

  handleCopyToAccount = async (event: SyntheticInputEvent<>) => {
    event.target.blur();
    const newAnnotation = await copyAnnotationToUserAccount(
      this.props.annotationId,
      this.props.tracingType,
    );
    location.href = `/annotations/Explorational/${newAnnotation.id}`;
  };

  handleFinish = async (event: SyntheticInputEvent<>) => {
    event.target.blur();
    const url = `/annotations/${this.props.tracingType}/${
      this.props.annotationId
    }/finishAndRedirect`;
    await this.handleSave();

    Modal.confirm({
      title: messages["annotation.finish"],
      onOk: () => {
        location.href = url;
      },
    });
  };

  handleShareOpen = () => {
    this.setState({ isShareModalOpen: true });
  };

  handleShareClose = () => {
    this.setState({ isShareModalOpen: false });
  };

  handleDownload = async (event: SyntheticInputEvent<>) => {
    event.target.blur();
    const win = window.open("about:blank", "_blank");
    win.document.body.innerHTML = messages["download.wait"];
    await this.handleSave();

    const downloadUrl = `/annotations/${this.props.tracingType}/${
      this.props.annotationId
    }/download`;
    win.location.href = downloadUrl;
    win.document.body.innerHTML = messages["download.close_window"];
  };

  handleFinishAndGetNextTask = async (event: SyntheticInputEvent<>) => {
    event.target.blur();
    api.tracing.finishAndGetNextTask();
  };

  handleMergeOpen = () => {
    this.setState({ isMergeModalOpen: true });
  };

  handleMergeClose = () => {
    this.setState({ isMergeModalOpen: false });
  };

  handleUserScriptsOpen = () => {
    this.setState({ isUserScriptsModalOpen: true });
  };

  handleUserScriptsClose = () => {
    this.setState({ isUserScriptsModalOpen: false });
  };

  render() {
    const viewMode = Store.getState().temporaryConfiguration.viewMode;
    const isSkeletonMode = Constants.MODES_SKELETON.includes(viewMode);
    const archiveButtonText = this.props.task ? "Finish" : "Archive";
    const restrictions = this.props.restrictions;

    const saveButton = restrictions.allowUpdate
      ? [
          isSkeletonMode
            ? [
                <ButtonComponent key="undo-button" title="Undo (Ctrl+Z)" onClick={this.handleUndo}>
                  <i className="fa fa-undo" aria-hidden="true" />
                </ButtonComponent>,
                <ButtonComponent key="redo-button" title="Redo (Ctrl+Y)" onClick={this.handleRedo}>
                  <i className="fa fa-repeat" aria-hidden="true" />
                </ButtonComponent>,
              ]
            : null,
          <SaveButton key="save-button" onClick={this.handleSave} />,
        ]
      : [
          <ButtonComponent key="read-only-button" type="primary" disabled>
            Read only
          </ButtonComponent>,
          isSkeletonMode ? (
            <ButtonComponent key="copy-button" icon="file-add" onClick={this.handleCopyToAccount}>
              Copy To My Account
            </ButtonComponent>
          ) : null,
        ];

    const finishAndNextTaskButton =
      restrictions.allowFinish && this.props.task ? (
        <ButtonComponent
          key="next-button"
          icon="verticle-left"
          onClick={this.handleFinishAndGetNextTask}
        >
          Finish and Get Next Task
        </ButtonComponent>
      ) : null;

    const elements = [];
    const modals = [];
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
    if (restrictions.allowDownload) {
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
    elements.push(
      <Menu.Item key="user-scripts-button">
        <div onClick={this.handleUserScriptsOpen}>
          <Icon type="setting" />
          Add Script
        </div>
      </Menu.Item>,
    );
    modals.push(
      <UserScriptsModalView
        key="user-scripts-modal"
        isVisible={this.state.isUserScriptsModalOpen}
        onOK={this.handleUserScriptsClose}
      />,
    );

    if (isSkeletonMode && this.props.activeUser != null) {
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

    const menu = <Menu>{elements}</Menu>;

    return (
      <div>
        <Button.Group>
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

function mapStateToProps(state: OxalisState): StateProps {
  return {
    tracingType: state.tracing.tracingType,
    annotationId: state.tracing.annotationId,
    restrictions: state.tracing.restrictions,
    task: state.task,
    activeUser: state.activeUser,
  };
}

export default connect(mapStateToProps)(TracingActionsView);
