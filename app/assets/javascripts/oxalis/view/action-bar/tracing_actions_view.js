// @flow
import React, { PureComponent } from "react";
import Model from "oxalis/model";
import Store from "oxalis/store";
import { connect } from "react-redux";
import { Upload, Button, Dropdown, Menu, Icon, Modal, Tooltip } from "antd";
import Constants from "oxalis/constants";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";
import UserScriptsModalView from "oxalis/view/action-bar/user_scripts_modal_view";
import SaveButton from "oxalis/view/action-bar/save_button";
import ButtonComponent from "oxalis/view/components/button_component";
import messages from "messages";
import api from "oxalis/api/internal_api";
import { undoAction, redoAction } from "oxalis/model/actions/save_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import { copyAnnotationToUserAccount, finishAnnotation } from "admin/admin_rest_api";
import { location } from "libs/window";
import type { OxalisState, RestrictionsAndSettings, Task } from "oxalis/store";
import type { APIUser, APITracingType } from "admin/api_flow_types";
import SceneController from "oxalis/controller/scene_controller";
import { readFileAsArrayBuffer } from "libs/read_file";
import { AsyncButton } from "components/async_clickables";
import { mapLayoutKeysToLanguage } from "oxalis/view/layouting/default_layout_configs";

type StateProps = {
  tracingType: APITracingType,
  annotationId: string,
  restrictions: RestrictionsAndSettings,
  task: ?Task,
  activeUser: ?APIUser,
};

type Props = StateProps & {
  storedLayoutNamesForView: Array<string>,
  layoutKey: string,
  activeLayout: string,
  onResetLayout: () => void,
  onSelectLayout: string => void,
  onDeleteLayout: string => void,
  addNewLayout: () => void,
};

type State = {
  isShareModalOpen: boolean,
  isMergeModalOpen: boolean,
  isUserScriptsModalOpen: boolean,
};

type ResetLayoutItemProps = {
  storedLayoutNamesForView: Array<string>,
  layoutKey: string,
  activeLayout: string,
  onResetLayout: () => void,
  onSelectLayout: string => void,
  onDeleteLayout: string => void,
  addNewLayout: () => void,
};

export const ResetLayoutItem = (props: ResetLayoutItemProps) => {
  const {
    storedLayoutNamesForView,
    layoutKey,
    activeLayout,
    onResetLayout,
    onSelectLayout,
    onDeleteLayout,
    addNewLayout,
    ...others
  } = props;
  const layoutMissingHelpTitle = (
    <React.Fragment>
      <h5 style={{ color: "#fff" }}>Where is my layout?</h5>
      <p>
        {`The tracing views are separated into four classes. Each of them has their own layouts. If you
        can't find your layout please open the tracing in the correct view mode or just add it here manually.`}
      </p>
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
        <span
          onClick={() => onSelectLayout(layout)}
          style={{ minWidth: "100%", minHeight: "auto", display: "inline-block" }}
        >
          <div className="inline-with-margin">
            {layout}
            {isSelectedLayout ? (
              <Icon type="check" className="sub-menu-item-icon" theme="outlined" />
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
        </span>
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
              className="sub-menu-item-icon"
            />
          </Tooltip>
        </span>
      }
    >
      <Menu.Item>
        <div onClick={onResetLayout}>Reset Layout</div>
      </Menu.Item>
      <Menu.Item>
        <div onClick={addNewLayout}>Add a new Layout</div>
      </Menu.Item>
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

class TracingActionsView extends PureComponent<Props, State> {
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

  handleDownload = async (event: SyntheticInputEvent<>) => {
    event.target.blur();
    const win = window.open("about:blank", "_blank");
    win.document.body.innerHTML = messages["download.wait"];
    await this.handleSave();

    const downloadUrl = `/api/annotations/${this.props.tracingType}/${
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

    if (restrictions.allowUpdate) {
      elements.push(
        <Menu.Item key="restore-button" onClick={this.handleRestore}>
          <Icon type="bars" theme="outlined" />
          Restore Older Version
        </Menu.Item>,
      );
    }

    elements.push(
      <ResetLayoutItem
        storedLayoutNamesForView={this.props.storedLayoutNamesForView}
        layoutKey={this.props.layoutKey}
        activeLayout={this.props.activeLayout}
        onResetLayout={this.props.onResetLayout}
        onSelectLayout={this.props.onSelectLayout}
        onDeleteLayout={this.props.onDeleteLayout}
        addNewLayout={this.props.addNewLayout}
        key="layout"
      />,
    );

    const onStlUpload = async info => {
      const buffer = await readFileAsArrayBuffer(info.file);
      SceneController.addSTL(buffer);
    };

    elements.push(
      <Menu.Item key="stl-mesh">
        <Upload beforeUpload={() => false} onChange={onStlUpload} showUploadList={false}>
          <Icon type="upload" />
          Import STL Mesh
        </Upload>
      </Menu.Item>,
    );

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
