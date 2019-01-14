// @flow

import { Button, Dropdown, Icon, Menu, Modal, Tooltip } from "antd";
import { connect } from "react-redux";
import * as React from "react";

import type { APIUser, APITracingType } from "admin/api_flow_types";
import { AsyncButton } from "components/async_clickables";
import { copyAnnotationToUserAccount, finishAnnotation } from "admin/admin_rest_api";
import { mapLayoutKeysToLanguage } from "oxalis/view/layouting/default_layout_configs";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import { undoAction, redoAction } from "oxalis/model/actions/save_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import Constants from "oxalis/constants";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import Model from "oxalis/model";
import SaveButton from "oxalis/view/action-bar/save_button";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";
import Store, { type OxalisState, type RestrictionsAndSettings, type Task } from "oxalis/store";
import UserScriptsModalView from "oxalis/view/action-bar/user_scripts_modal_view";
import api from "oxalis/api/internal_api";
import messages from "messages";
import window, { location } from "libs/window";

type StateProps = {
  tracingType: APITracingType,
  annotationId: string,
  restrictions: RestrictionsAndSettings,
  task: ?Task,
  activeUser: ?APIUser,
};

type Props = StateProps & {
  layoutMenu: React.Node,
};

type State = {
  isShareModalOpen: boolean,
  isMergeModalOpen: boolean,
  isUserScriptsModalOpen: boolean,
};

type LayoutMenuProps = {
  storedLayoutNamesForView: Array<string>,
  layoutKey: string,
  activeLayout: string,
  onResetLayout: () => void,
  onSelectLayout: string => void,
  onDeleteLayout: string => void,
  addNewLayout: () => void,
  autoSaveLayouts: boolean,
  setAutoSaveLayouts: boolean => void,
  saveCurrentLayout: () => void,
};

export const LayoutMenu = (props: LayoutMenuProps) => {
  const {
    storedLayoutNamesForView,
    layoutKey,
    activeLayout,
    onResetLayout,
    onSelectLayout,
    onDeleteLayout,
    addNewLayout,
    autoSaveLayouts,
    setAutoSaveLayouts,
    saveCurrentLayout,
    ...others
  } = props;
  const layoutMissingHelpTitle = (
    <React.Fragment>
      <h5 style={{ color: "#fff" }}>Where is my layout?</h5>
      <p>{messages["layouting.missing_custom_layout_info"]}</p>
    </React.Fragment>
  );
  const customLayoutsItems = storedLayoutNamesForView.map(layout => {
    const isSelectedLayout = layout === activeLayout;
    return (
      <Menu.Item
        key={layout}
        className={
          isSelectedLayout ? "selected-layout-item bullet-point-less-li" : "bullet-point-less-li"
        }
      >
        <div className="layout-dropdown-list-item-container">
          <div className="layout-dropdown-selection-area" onClick={() => onSelectLayout(layout)}>
            {layout}
          </div>
          {isSelectedLayout ? (
            <Icon type="check" theme="outlined" className="sub-menu-item-icon" />
          ) : (
            <Tooltip placement="top" title="Remove this layout">
              <Icon
                type="delete"
                className="clickable-icon sub-menu-item-icon"
                onClick={() => onDeleteLayout(layout)}
              />
            </Tooltip>
          )}
        </div>
      </Menu.Item>
    );
  });
  return (
    <Menu.SubMenu
      {...others}
      title={
        <span style={{ display: "inline-block", minWidth: 120 }}>
          <Icon type="laptop" /> Layout
          <Tooltip placement="top" title={layoutMissingHelpTitle}>
            <Icon
              type="info-circle-o"
              style={{ color: "gray", marginRight: 36 }}
              className="right-floating-icon"
            />
          </Tooltip>
        </span>
      }
    >
      <Menu.Item style={{ display: "inline-block" }} onClick={addNewLayout}>
        <Tooltip title="Add a new Layout">
          <Icon type="plus" />
        </Tooltip>
      </Menu.Item>
      <Menu.Item style={{ display: "inline-block" }} onClick={onResetLayout}>
        <Tooltip title="Reset Layout">
          <Icon type="rollback" />
        </Tooltip>
      </Menu.Item>
      <Menu.Item
        style={{ display: "inline-block" }}
        onClick={() => setAutoSaveLayouts(!autoSaveLayouts)}
      >
        <Tooltip title={`${autoSaveLayouts ? "Disable" : "Enable"} auto-saving of current layout`}>
          <Icon type={autoSaveLayouts ? "disconnect" : "link"} />
        </Tooltip>
      </Menu.Item>
      {autoSaveLayouts ? null : (
        <Menu.Item style={{ display: "inline-block" }} onClick={saveCurrentLayout}>
          <Tooltip title="Save current layout">
            <Icon type="save" />
          </Tooltip>
        </Menu.Item>
      )}
      <Menu.Divider />
      <Menu.ItemGroup
        className="available-layout-list"
        title={
          <span style={{ fontSize: 14 }}>{`Layouts for ${
            mapLayoutKeysToLanguage[layoutKey]
          }`}</span>
        }
      >
        {customLayoutsItems}
      </Menu.ItemGroup>
    </Menu.SubMenu>
  );
};

class TracingActionsView extends React.PureComponent<Props, State> {
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

  handleRestore = async () => {
    await Model.save();
    Store.dispatch(setVersionRestoreVisibilityAction(true));
  };

  handleRedo = () => {
    Store.dispatch(redoAction());
  };

  handleCopyToAccount = async () => {
    const newAnnotation = await copyAnnotationToUserAccount(
      this.props.annotationId,
      this.props.tracingType,
    );
    location.href = `/annotations/Explorational/${newAnnotation.id}`;
  };

  handleFinish = async () => {
    await this.handleSave();

    Modal.confirm({
      title: messages["annotation.finish"],
      onOk: async () => {
        await finishAnnotation(this.props.annotationId, this.props.tracingType);
        // Force page refresh
        location.href = "/dashboard";
      },
    });
  };

  handleShareOpen = () => {
    this.setState({ isShareModalOpen: true });
  };

  handleShareClose = () => {
    this.setState({ isShareModalOpen: false });
  };

  handleDownload = async () => {
    const win = window.open("about:blank", "_blank");
    win.document.body.innerHTML = messages["download.wait"];
    await this.handleSave();

    const downloadUrl = `/api/annotations/${this.props.tracingType}/${
      this.props.annotationId
    }/download`;
    win.location.href = downloadUrl;
    win.document.body.innerHTML = messages["download.close_window"];
  };

  handleFinishAndGetNextTask = async () => {
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
    const { viewMode } = Store.getState().temporaryConfiguration;
    const isSkeletonMode = Constants.MODES_SKELETON.includes(viewMode);
    const archiveButtonText = this.props.task ? "Finish" : "Archive";
    const { restrictions } = this.props;

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
          <AsyncButton key="copy-button" icon="file-add" onClick={this.handleCopyToAccount}>
            Copy To My Account
          </AsyncButton>,
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
        <Menu.Item key="finish-button" onClick={this.handleFinish}>
          <Icon type="check-circle-o" />
          {archiveButtonText}
        </Menu.Item>,
      );
    }
    if (restrictions.allowDownload) {
      elements.push(
        <Menu.Item key="download-button" onClick={this.handleDownload}>
          <Icon type="download" />
          Download
        </Menu.Item>,
      );
    }
    elements.push(
      <Menu.Item key="share-button" onClick={this.handleShareOpen}>
        <Icon type="share-alt" />
        Share
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
      <Menu.Item key="user-scripts-button" onClick={this.handleUserScriptsOpen}>
        <Icon type="setting" />
        Add Script
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
        <Menu.Item key="merge-button" onClick={this.handleMergeOpen}>
          <Icon type="folder-open" />
          Merge Tracing
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

    if (restrictions.allowUpdate) {
      elements.push(
        <Menu.Item key="restore-button" onClick={this.handleRestore}>
          <Icon type="bars" theme="outlined" />
          Restore Older Version
        </Menu.Item>,
      );
    }

    elements.push(this.props.layoutMenu);

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
