// @flow

import { Button, Dropdown, Menu, Modal, Tooltip } from "antd";
import {
  BarsOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CodeSandboxOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  DownloadOutlined,
  DownOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LayoutOutlined,
  LinkOutlined,
  PlusOutlined,
  RollbackOutlined,
  SaveOutlined,
  SettingOutlined,
  ShareAltOutlined,
  StopOutlined,
  VerticalLeftOutlined,
  VerticalRightOutlined,
} from "@ant-design/icons";
import { connect } from "react-redux";
import * as React from "react";

import {
  APIAnnotationTypeEnum,
  type APIAnnotationType,
  type APIUser,
  TracingTypeEnum,
} from "types/api_flow_types";
import { AsyncButton } from "components/async_clickables";
import {
  type LayoutKeys,
  mapLayoutKeysToLanguage,
} from "oxalis/view/layouting/default_layout_configs";
import {
  copyAnnotationToUserAccount,
  downloadNml,
  finishAnnotation,
  reOpenAnnotation,
  createExplorational,
} from "admin/admin_rest_api";
import { location } from "libs/window";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import { setTracingAction } from "oxalis/model/actions/skeletontracing_actions";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { undoAction, redoAction, disableSavingAction } from "oxalis/model/actions/save_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import Constants, { ControlModeEnum } from "oxalis/constants";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import Model from "oxalis/model";
import SaveButton from "oxalis/view/action-bar/save_button";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";
import Store, { type OxalisState, type RestrictionsAndSettings, type Task } from "oxalis/store";
import UserScriptsModalView from "oxalis/view/action-bar/user_scripts_modal_view";
import api from "oxalis/api/internal_api";
import messages from "messages";
import { screenshotMenuItem } from "oxalis/view/action-bar/view_dataset_actions_view";
import UserLocalStorage from "libs/user_local_storage";
import features from "features";
import { getTracingType } from "oxalis/model/accessors/tracing_accessor";
import Toast from "libs/toast";
import UrlManager from "oxalis/controller/url_manager";
import { withAuthentication } from "admin/auth/authentication_modal";

const AsyncButtonWithAuthentication = withAuthentication(AsyncButton);

type OwnProps = {|
  layoutMenu: React.Node,
  hasVolumeFallback: boolean,
|};
type StateProps = {|
  annotationType: APIAnnotationType,
  annotationId: string,
  restrictions: RestrictionsAndSettings,
  task: ?Task,
  activeUser: ?APIUser,
  hasTracing: boolean,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  isShareModalOpen: boolean,
  isMergeModalOpen: boolean,
  isUserScriptsModalOpen: boolean,
  isReopenAllowed: boolean,
};

export type LayoutProps = {
  storedLayoutNamesForView: Array<string>,
  activeLayout: string,
  layoutKey: LayoutKeys,
  autoSaveLayouts: boolean,
  setAutoSaveLayouts: boolean => void,
  setCurrentLayout: string => void,
  saveCurrentLayout: () => void,
};

type LayoutMenuProps = LayoutProps & {
  onResetLayout: () => void,
  onSelectLayout: string => void,
  onDeleteLayout: string => void,
  addNewLayout: () => void,
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
    setCurrentLayout,
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
            <CheckOutlined className="sub-menu-item-icon" />
          ) : (
            <Tooltip placement="top" title="Remove this layout">
              <DeleteOutlined
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
          <LayoutOutlined />
          Layout
          <Tooltip placement="top" title={layoutMissingHelpTitle}>
            <InfoCircleOutlined
              style={{ color: "gray", marginRight: 36 }}
              className="right-floating-icon"
            />
          </Tooltip>
        </span>
      }
    >
      <Menu.Item
        style={{ display: "inline-block" }}
        onClick={addNewLayout}
        title="Add a new Layout"
      >
        <PlusOutlined />
      </Menu.Item>
      <Menu.Item style={{ display: "inline-block" }} onClick={onResetLayout} title="Reset Layout">
        <RollbackOutlined />
      </Menu.Item>
      <Menu.Item
        style={{ display: "inline-block" }}
        onClick={() => setAutoSaveLayouts(!autoSaveLayouts)}
        title={`${autoSaveLayouts ? "Disable" : "Enable"} auto-saving of current layout`}
      >
        {autoSaveLayouts ? <DisconnectOutlined /> : <LinkOutlined />}
      </Menu.Item>
      {autoSaveLayouts ? null : (
        <Menu.Item
          style={{ display: "inline-block" }}
          onClick={saveCurrentLayout}
          title="Save current layout"
        >
          <SaveOutlined />
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
    isReopenAllowed: false,
  };

  modalWrapper: ?HTMLDivElement = null;
  reopenTimeout: ?TimeoutID;

  componentDidUpdate = () => {
    const localStorageEntry = UserLocalStorage.getItem("lastFinishedTask");
    if (this.props.task && localStorageEntry) {
      const { finishedTime } = JSON.parse(localStorageEntry);
      const timeSinceFinish = Date.now() - finishedTime;
      const reopenAllowedTime = features().taskReopenAllowedInSeconds * 1000;
      if (timeSinceFinish < reopenAllowedTime) {
        // eslint-disable-next-line react/no-did-update-set-state
        this.setState({
          isReopenAllowed: true,
        });
        if (this.reopenTimeout != null) {
          clearTimeout(this.reopenTimeout);
          this.reopenTimeout = null;
        }
        this.reopenTimeout = setTimeout(() => {
          this.setState({ isReopenAllowed: false });
          UserLocalStorage.removeItem("lastFinishedTask");
          this.reopenTimeout = null;
        }, reopenAllowedTime - timeSinceFinish);
      }
    }
  };

  componentWillUnmount() {
    if (this.reopenTimeout != null) {
      clearTimeout(this.reopenTimeout);
    }
  }

  handleSave = async (event?: SyntheticInputEvent<>) => {
    if (event != null) {
      event.target.blur();
    }
    Model.forceSave();
  };

  handleUndo = () => {
    Store.dispatch(undoAction());
  };

  handleRestore = async () => {
    await Model.ensureSavedState();
    Store.dispatch(setVersionRestoreVisibilityAction(true));
  };

  handleRedo = () => {
    Store.dispatch(redoAction());
  };

  handleCopyToAccount = async () => {
    const newAnnotation = await copyAnnotationToUserAccount(
      this.props.annotationId,
      this.props.annotationType,
    );
    location.href = `/annotations/Explorational/${newAnnotation.id}`;
  };

  handleCopySandboxToAccount = async () => {
    const { tracing: sandboxTracing, dataset } = Store.getState();
    const tracingType = getTracingType(sandboxTracing);

    if (tracingType !== TracingTypeEnum.skeleton) {
      const message = "Sandbox copying functionality is only implemented for skeleton tracings.";
      Toast.error(message);
      throw Error(message);
    }

    const fallbackLayer =
      sandboxTracing.volume != null ? sandboxTracing.volume.fallbackLayer : null;

    const newAnnotation = await createExplorational(dataset, tracingType, fallbackLayer);
    UrlManager.changeBaseUrl(`/annotations/${newAnnotation.typ}/${newAnnotation.id}`);
    await api.tracing.restart(
      newAnnotation.typ,
      newAnnotation.id,
      ControlModeEnum.TRACE,
      undefined,
      true,
    );

    const sandboxSkeletonTracing = enforceSkeletonTracing(sandboxTracing);
    const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
    // Update the sandbox tracing with the new tracingId and createdTimestamp
    const newSkeletonTracing = {
      ...sandboxSkeletonTracing,
      tracingId: skeletonTracing.tracingId,
      createdTimestamp: skeletonTracing.createdTimestamp,
    };
    Store.dispatch(setTracingAction(newSkeletonTracing));
  };

  handleFinish = async () => {
    await Model.ensureSavedState();

    Modal.confirm({
      title: messages["annotation.finish"],
      onOk: async () => {
        await finishAnnotation(this.props.annotationId, this.props.annotationType);
        // Force page refresh
        location.href = "/dashboard";
      },
    });
  };

  handleDisableSaving = () => {
    Modal.confirm({
      title: messages["annotation.disable_saving"],
      content: messages["annotation.disable_saving.content"],
      onOk: () => {
        Store.dispatch(disableSavingAction());
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
    await Model.ensureSavedState();
    const { annotationId, annotationType, hasVolumeFallback } = this.props;
    downloadNml(annotationId, annotationType, hasVolumeFallback);
  };

  handleFinishAndGetNextTask = async () => {
    api.tracing.finishAndGetNextTask();
  };

  handleReopenTask = async () => {
    const localStorageEntry = UserLocalStorage.getItem("lastFinishedTask");
    if (!localStorageEntry) return;

    const { annotationId } = JSON.parse(localStorageEntry);

    if (annotationId) {
      Modal.confirm({
        title: messages["annotation.undoFinish.confirm"],
        content: messages["annotation.undoFinish.content"],
        onOk: async () => {
          await Model.ensureSavedState();
          await reOpenAnnotation(annotationId, APIAnnotationTypeEnum.Task);
          UserLocalStorage.removeItem("lastFinishedTask");
          const newTaskUrl = `/annotations/${APIAnnotationTypeEnum.Task}/${annotationId}`;
          location.href = newTaskUrl;
        },
      });
    }
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
    const {
      hasTracing,
      restrictions,
      task,
      annotationType,
      annotationId,
      activeUser,
      layoutMenu,
    } = this.props;
    const archiveButtonText = task ? "Finish and go to Dashboard" : "Archive";

    const saveButton = restrictions.allowUpdate
      ? [
          hasTracing
            ? [
                <ButtonComponent
                  className="narrow"
                  key="undo-button"
                  title="Undo (Ctrl+Z)"
                  onClick={this.handleUndo}
                >
                  <i className="fas fa-undo" aria-hidden="true" />
                </ButtonComponent>,
                <ButtonComponent
                  className="narrow hide-on-small-screen"
                  key="redo-button"
                  title="Redo (Ctrl+Y)"
                  onClick={this.handleRedo}
                >
                  <i className="fas fa-redo" aria-hidden="true" />
                </ButtonComponent>,
              ]
            : null,
          restrictions.allowSave ? (
            <SaveButton className="narrow" key="save-button" onClick={this.handleSave} />
          ) : (
            [
              <Tooltip
                placement="bottom"
                title="This annotation was opened in sandbox mode. You can edit it, but changes are not saved. Use 'Copy To My Account' to copy the current state to your account."
                key="sandbox-tooltip"
              >
                <Button disabled type="primary" icon={<CodeSandboxOutlined />}>
                  <span className="hide-on-small-screen">Sandbox</span>
                </Button>
              </Tooltip>,
              <AsyncButtonWithAuthentication
                activeUser={activeUser}
                authenticationMessage="Please register or login to copy the sandbox tracing to your account."
                key="copy-sandbox-button"
                icon={<FileAddOutlined />}
                onClick={this.handleCopySandboxToAccount}
                title="Copy To My Account"
              >
                <span className="hide-on-small-screen">Copy To My Account</span>
              </AsyncButtonWithAuthentication>,
            ]
          ),
        ]
      : [
          <ButtonComponent
            key="read-only-button"
            type="danger"
            disabled
            style={{ backgroundColor: "var(--ant-warning-dark-5)" }}
          >
            Read only
          </ButtonComponent>,
          <AsyncButtonWithAuthentication
            activeUser={activeUser}
            authenticationMessage="Please register or login to copy the tracing to your account."
            key="copy-button"
            icon={<FileAddOutlined />}
            onClick={this.handleCopyToAccount}
            title="Copy To My Account"
          >
            <span className="hide-on-small-screen">Copy To My Account</span>
          </AsyncButtonWithAuthentication>,
        ];

    const finishAndNextTaskButton =
      restrictions.allowFinish && task ? (
        <ButtonComponent
          key="next-button"
          icon={<VerticalLeftOutlined />}
          onClick={this.handleFinishAndGetNextTask}
        >
          Finish and Get Next Task
        </ButtonComponent>
      ) : null;

    const reopenTaskButton = this.state.isReopenAllowed ? (
      <ButtonComponent
        key="reopen-button"
        icon={<VerticalRightOutlined />}
        onClick={this.handleReopenTask}
        danger
      >
        Undo Finish
      </ButtonComponent>
    ) : null;

    const elements = [];
    const modals = [];
    if (restrictions.allowFinish) {
      elements.push(
        <Menu.Item key="finish-button" onClick={this.handleFinish}>
          <CheckCircleOutlined />
          {archiveButtonText}
        </Menu.Item>,
      );
    }

    if (restrictions.allowDownload) {
      elements.push(
        <Menu.Item key="download-button" onClick={this.handleDownload}>
          <DownloadOutlined />
          Download
        </Menu.Item>,
      );
    }
    elements.push(
      <Menu.Item key="share-button" onClick={this.handleShareOpen}>
        <ShareAltOutlined />
        Share
      </Menu.Item>,
    );
    modals.push(
      <ShareModalView
        key="share-modal"
        isVisible={this.state.isShareModalOpen}
        onOk={this.handleShareClose}
        annotationType={annotationType}
        annotationId={annotationId}
      />,
    );
    elements.push(screenshotMenuItem);
    elements.push(
      <Menu.Item key="user-scripts-button" onClick={this.handleUserScriptsOpen}>
        <SettingOutlined />
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

    if (restrictions.allowSave && isSkeletonMode && activeUser != null) {
      elements.push(
        <Menu.Item key="merge-button" onClick={this.handleMergeOpen}>
          <FolderOpenOutlined />
          Merge Annotation
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

    if (restrictions.allowSave) {
      elements.push(
        <Menu.Item key="restore-button" onClick={this.handleRestore}>
          <BarsOutlined />
          Restore Older Version
        </Menu.Item>,
      );
    }

    elements.push(layoutMenu);

    if (restrictions.allowSave && !task) {
      elements.push(
        <Menu.Item key="disable-saving" onClick={this.handleDisableSaving}>
          <StopOutlined />
          Disable saving
        </Menu.Item>,
      );
    }

    const menu = <Menu>{elements}</Menu>;
    return (
      <div>
        <div className="antd-legacy-group">
          {saveButton}
          {finishAndNextTaskButton}
          {reopenTaskButton}
          {modals}
          <Dropdown overlay={menu} trigger={["click"]}>
            <ButtonComponent className="narrow">
              <DownOutlined />
            </ButtonComponent>
          </Dropdown>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  return {
    annotationType: state.tracing.annotationType,
    annotationId: state.tracing.annotationId,
    restrictions: state.tracing.restrictions,
    task: state.task,
    activeUser: state.activeUser,
    hasTracing: (state.tracing.skeleton || state.tracing.volume) != null,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(TracingActionsView);
