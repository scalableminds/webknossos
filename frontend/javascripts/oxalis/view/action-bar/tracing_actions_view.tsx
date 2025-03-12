import {
  CheckCircleOutlined,
  CheckOutlined,
  CodeSandboxOutlined,
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  DownOutlined,
  DownloadOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  LayoutOutlined,
  LinkOutlined,
  LockOutlined,
  PlusOutlined,
  RollbackOutlined,
  SaveOutlined,
  SettingOutlined,
  ShareAltOutlined,
  StopOutlined,
  UnlockOutlined,
  VerticalLeftOutlined,
  VerticalRightOutlined,
} from "@ant-design/icons";
import {
  createExplorational,
  duplicateAnnotation,
  editLockedState,
  finishAnnotation,
  reOpenAnnotation,
} from "admin/admin_rest_api";
import { withAuthentication } from "admin/auth/authentication_modal";
import { Button, ConfigProvider, Dropdown, Modal, Space, Tooltip } from "antd";
import type { SubMenuType } from "antd/es/menu/interface";
import { AsyncButton, type AsyncButtonProps } from "components/async_clickables";
import features from "features";
import Toast from "libs/toast";
import UserLocalStorage from "libs/user_local_storage";
import * as Utils from "libs/utils";
import { location } from "libs/window";
import messages from "messages";
import Constants, { ControlModeEnum } from "oxalis/constants";
import UrlManager from "oxalis/controller/url_manager";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getTracingType } from "oxalis/model/accessors/tracing_accessor";
import {
  disableSavingAction,
  dispatchRedoAsync,
  dispatchUndoAsync,
} from "oxalis/model/actions/save_actions";
import { setTracingAction } from "oxalis/model/actions/skeletontracing_actions";
import {
  setDownloadModalVisibilityAction,
  setMergeModalVisibilityAction,
  setRenderAnimationModalVisibilityAction,
  setShareModalVisibilityAction,
  setUserScriptsModalVisibilityAction,
  setVersionRestoreVisibilityAction,
  setZarrLinksModalVisibilityAction,
} from "oxalis/model/actions/ui_actions";
import { Model } from "oxalis/singletons";
import { api } from "oxalis/singletons";
import type { BusyBlockingInfo, OxalisState, RestrictionsAndSettings, Task } from "oxalis/store";
import Store from "oxalis/store";
import DownloadModalView from "oxalis/view/action-bar/download_modal_view";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import SaveButton from "oxalis/view/action-bar/save_button";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";
import UserScriptsModalView from "oxalis/view/action-bar/user_scripts_modal_view";
import {
  renderAnimationMenuItem,
  screenshotMenuItem,
} from "oxalis/view/action-bar/view_dataset_actions_view";
import ButtonComponent from "oxalis/view/components/button_component";
import type { LayoutKeys } from "oxalis/view/layouting/default_layout_configs";
import { mapLayoutKeysToLanguage } from "oxalis/view/layouting/default_layout_configs";
import * as React from "react";
import { connect } from "react-redux";
import { getAntdTheme, getThemeFromUser } from "theme";
import type { APIAnnotationType, APIUser, APIUserBase } from "types/api_flow_types";
import { APIAnnotationTypeEnum, TracingTypeEnum } from "types/api_flow_types";
import CreateAnimationModal from "./create_animation_modal";
import { PrivateLinksModal } from "./private_links_view";

const AsyncButtonWithAuthentication = withAuthentication<AsyncButtonProps, typeof AsyncButton>(
  AsyncButton,
);

type OwnProps = {
  layoutMenu: SubMenuType | null;
};
type StateProps = {
  hasTracing: boolean;
  busyBlockingInfo: BusyBlockingInfo;
  annotationTags: string[];
  isRenderAnimationModalOpen: boolean;
  isShareModalOpen: boolean;
  isDownloadModalOpen: boolean;
  isMergeModalOpen: boolean;
  isUserScriptsModalOpen: boolean;
  isZarrPrivateLinksModalOpen: boolean;
} & TracingViewMenuProps;
type Props = OwnProps & StateProps;
export type TracingViewMenuProps = {
  restrictions: RestrictionsAndSettings;
  task: Task | null | undefined;
  annotationType: APIAnnotationType;
  annotationId: string;
  activeUser: APIUser | null | undefined;
  isAnnotationLockedByUser: boolean;
  annotationOwner: APIUserBase | null | undefined;
};
type State = {
  isReopenAllowed: boolean;
};

export type LayoutProps = {
  storedLayoutNamesForView: string[];
  activeLayout: string;
  layoutKey: LayoutKeys;
  autoSaveLayouts: boolean;
  setAutoSaveLayouts: (arg0: boolean) => void;
  setCurrentLayout: (arg0: string) => void;
  saveCurrentLayout: () => void;
};
type LayoutMenuProps = LayoutProps & {
  onResetLayout: () => void;
  onSelectLayout: (arg0: string) => void;
  onDeleteLayout: (arg0: string) => void;
  addNewLayout: () => void;
};

export function getLayoutMenu(props: LayoutMenuProps): SubMenuType {
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
    // biome-ignore lint/correctness/noUnusedVariables: underscore prefix does not work with object destructuring
    setCurrentLayout,
  } = props;

  const layoutMissingHelpTitle = (
    <React.Fragment>
      <h5
        style={{
          color: "#fff",
        }}
      >
        Where is my layout?
      </h5>
      <p>{messages["layouting.missing_custom_layout_info"]}</p>
    </React.Fragment>
  );

  const customLayoutsItems = storedLayoutNamesForView.map((layout) => {
    const isSelectedLayout = layout === activeLayout;
    return {
      key: layout,
      className: isSelectedLayout
        ? "selected-layout-item bullet-point-less-li"
        : "bullet-point-less-li",
      label: (
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
      ),
    };
  });

  return {
    key: "layout-menu",
    icon: <LayoutOutlined />,
    label: (
      <span
        style={{
          display: "inline-block",
          minWidth: 120,
        }}
      >
        Layout
        <Tooltip placement="top" title={layoutMissingHelpTitle}>
          <InfoCircleOutlined
            style={{
              color: "gray",
              marginRight: 36,
            }}
            className="right-floating-icon"
          />
        </Tooltip>
      </span>
    ),
    children: [
      {
        key: "new-layout",
        style: {
          display: "inline-block",
        },
        onClick: addNewLayout,
        title: "Add a new Layout",
        icon: <PlusOutlined />,
      },
      {
        key: "reset-layout",
        style: {
          display: "inline-block",
        },
        onClick: onResetLayout,
        title: "Reset Layout",
        icon: <RollbackOutlined />,
      },
      {
        key: "autosave-layout",
        style: {
          display: "inline-block",
        },
        onClick: () => setAutoSaveLayouts(!autoSaveLayouts),
        title: `${autoSaveLayouts ? "Disable" : "Enable"} auto-saving of current layout`,
        icon: autoSaveLayouts ? <DisconnectOutlined /> : <LinkOutlined />,
      },
      autoSaveLayouts
        ? null
        : {
            key: "save-layout",
            style: {
              display: "inline-block",
            },
            onClick: saveCurrentLayout,
            title: "Save current layout",
            icon: <SaveOutlined />,
          },
      { key: "divider", type: "divider" },
      {
        key: "available-layouts",
        type: "group",
        className: "available-layout-list",
        label: (
          <span
            style={{
              fontSize: 14,
            }}
          >{`Layouts for ${mapLayoutKeysToLanguage[layoutKey]}`}</span>
        ),
        children: customLayoutsItems,
      },
    ],
  };
}

const handleRestore = async () => {
  await Model.ensureSavedState();
  Store.dispatch(setVersionRestoreVisibilityAction(true));
};

const handleDisableSaving = () => {
  Modal.confirm({
    title: messages["annotation.disable_saving"],
    content: messages["annotation.disable_saving.content"],
    onOk: () => {
      Store.dispatch(disableSavingAction());
    },
  });
};

const handleShareOpen = () => {
  Store.dispatch(setShareModalVisibilityAction(true));
};

const handleShareClose = () => {
  Store.dispatch(setShareModalVisibilityAction(false));
};

const handleDownloadOpen = () => {
  Store.dispatch(setDownloadModalVisibilityAction(true));
};

const handleDownloadClose = () => {
  Store.dispatch(setDownloadModalVisibilityAction(false));
};

const handleMergeOpen = () => {
  Store.dispatch(setMergeModalVisibilityAction(true));
};

const handleMergeClose = () => {
  Store.dispatch(setMergeModalVisibilityAction(false));
};

const handleUserScriptsOpen = () => {
  Store.dispatch(setUserScriptsModalVisibilityAction(true));
};

const handleUserScriptsClose = () => {
  Store.dispatch(setUserScriptsModalVisibilityAction(false));
};

const handleZarrLinksOpen = () => {
  Store.dispatch(setZarrLinksModalVisibilityAction(true));
};

const handleZarrLinksClose = () => {
  Store.dispatch(setZarrLinksModalVisibilityAction(false));
};

const handleChangeLockedStateOfAnnotation = async (
  isLocked: boolean,
  annotationId: string,
  annotationType: APIAnnotationType,
) => {
  try {
    // Ensure saved state, before (un)locking the annotation and then reloading.
    await Model.ensureSavedState();
    await editLockedState(annotationId, annotationType, isLocked);
    Toast.success(
      isLocked ? messages["annotation.lock.success"] : messages["annotation.unlock.success"],
    );
    // Give some time to show the toast before reloading the page.
    await Utils.sleep(250);
    location.reload();
  } catch (error: any) {
    const verb = isLocked ? "lock" : "unlock";
    Toast.error(`Could not ${verb} the annotation. ` + error?.message);
    console.error(`Could not ${verb} the annotation. `, error);
  }
};

const handleFinish = async (annotationId: string, annotationType: APIAnnotationType) => {
  await Model.ensureSavedState();
  Modal.confirm({
    title: messages["annotation.finish"],
    onOk: async () => {
      await finishAnnotation(annotationId, annotationType);
      // Force page refresh
      location.href = "/dashboard";
    },
  });
};

const handleDuplicate = async (annotationId: string, annotationType: APIAnnotationType) => {
  await Model.ensureSavedState();
  const newAnnotation = await duplicateAnnotation(annotationId, annotationType);
  window.open(`/annotations/${newAnnotation.id}`, "_blank", "noopener,noreferrer");
};

export const getTracingViewMenuItems = (
  props: TracingViewMenuProps,
  layoutMenu: SubMenuType | null,
) => {
  const { viewMode, controlMode } = Store.getState().temporaryConfiguration;
  const isSkeletonMode = Constants.MODES_SKELETON.includes(viewMode);
  const {
    restrictions,
    task,
    annotationType,
    annotationId,
    activeUser,
    isAnnotationLockedByUser,
    annotationOwner,
  } = props;
  const isAnnotationOwner = activeUser && annotationOwner?.id === activeUser?.id;
  const archiveButtonText = task ? "Finish and go to Dashboard" : "Archive";
  const menuItems = [];

  if (restrictions.allowFinish) {
    menuItems.push({
      key: "finish-button",
      onClick: () => handleFinish(annotationId, annotationType),
      icon: <CheckCircleOutlined />,
      label: archiveButtonText,
    });
  }

  if (restrictions.allowDownload) {
    menuItems.push({
      key: "download-button",
      onClick: handleDownloadOpen,
      icon: <DownloadOutlined />,
      label: "Download",
    });
  }

  menuItems.push({
    key: "share-button",
    onClick: handleShareOpen,
    icon: <ShareAltOutlined />,
    label: "Share",
  });
  menuItems.push({
    key: "zarr-links-button",
    onClick: handleZarrLinksOpen,
    icon: <LinkOutlined />,
    label: "Zarr Links",
  });

  if (activeUser != null) {
    menuItems.push({
      key: "duplicate-button",
      onClick: () => handleDuplicate(annotationId, annotationType),
      icon: <CopyOutlined />,
      label: "Duplicate",
    });
  }

  menuItems.push(screenshotMenuItem);

  menuItems.push(renderAnimationMenuItem);

  menuItems.push({
    key: "user-scripts-button",
    onClick: handleUserScriptsOpen,
    icon: <SettingOutlined />,
    label: "Add Script",
  });

  if (restrictions.allowSave && isSkeletonMode && activeUser != null) {
    menuItems.push({
      key: "merge-button",
      onClick: handleMergeOpen,
      icon: <FolderOpenOutlined />,
      label: "Merge Annotation",
    });
  }
  if (controlMode !== ControlModeEnum.SANDBOX) {
    menuItems.push({
      key: "restore-button",
      onClick: handleRestore,
      icon: <HistoryOutlined />,
      label: "Restore Older Version",
    });
  }

  if (layoutMenu != null) menuItems.push(layoutMenu);

  if (restrictions.allowSave && !task) {
    menuItems.push({
      key: "disable-saving",
      onClick: handleDisableSaving,
      icon: <StopOutlined />,
      label: "Disable saving",
    });
  }
  if (isAnnotationOwner) {
    menuItems.push({
      key: "lock-unlock-button",
      onClick: () =>
        handleChangeLockedStateOfAnnotation(
          !isAnnotationLockedByUser,
          annotationId,
          annotationType,
        ),
      icon: isAnnotationLockedByUser ? <UnlockOutlined /> : <LockOutlined />,
      label: `${isAnnotationLockedByUser ? "Unlock" : "Lock"} Annotation`,
    });
  }

  return menuItems;
};

class TracingActionsView extends React.PureComponent<Props, State> {
  state: State = {
    isReopenAllowed: false,
  };

  reopenTimeout: ReturnType<typeof setTimeout> | null | undefined;

  componentDidUpdate() {
    const localStorageEntry = UserLocalStorage.getItem("lastFinishedTask");

    if (this.props.task && localStorageEntry) {
      const { finishedTime } = JSON.parse(localStorageEntry);
      const timeSinceFinish = Date.now() - finishedTime;
      const reopenAllowedTime = features().taskReopenAllowedInSeconds * 1000;

      if (timeSinceFinish < reopenAllowedTime) {
        this.setState({
          isReopenAllowed: true,
        });

        if (this.reopenTimeout != null) {
          clearTimeout(this.reopenTimeout);
          this.reopenTimeout = null;
        }

        this.reopenTimeout = setTimeout(() => {
          this.setState({
            isReopenAllowed: false,
          });
          UserLocalStorage.removeItem("lastFinishedTask");
          this.reopenTimeout = null;
        }, reopenAllowedTime - timeSinceFinish);
      }
    }
  }

  componentWillUnmount() {
    if (this.reopenTimeout != null) {
      clearTimeout(this.reopenTimeout);
    }
  }

  handleSave = async (event?: React.SyntheticEvent) => {
    if (event != null) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'EventTarge... Remove this comment to see the full error message
      event.target.blur();
    }

    Model.forceSave();
  };

  handleUndo = () => dispatchUndoAsync(Store.dispatch);
  handleRedo = () => dispatchRedoAsync(Store.dispatch);

  handleCopyToAccount = async () => {
    // duplicates the annotation in the current user account
    const newAnnotation = await duplicateAnnotation(
      this.props.annotationId,
      this.props.annotationType,
    );
    location.href = `/annotations/${newAnnotation.id}`;
  };

  handleCopySandboxToAccount = async () => {
    const { tracing: sandboxTracing, dataset } = Store.getState();
    const tracingType = getTracingType(sandboxTracing);

    if (tracingType !== TracingTypeEnum.skeleton) {
      const message = "Sandbox copying functionality is only implemented for skeleton tracings.";
      Toast.error(message);
      throw Error(message);
    }

    // todo: does this logic make sense at all? the above condition seems to exclude
    // volume tracings
    const fallbackLayer =
      sandboxTracing.volumes.length > 0 ? sandboxTracing.volumes[0].fallbackLayer : null;
    const newAnnotation = await createExplorational(dataset.id, tracingType, false, fallbackLayer);
    UrlManager.changeBaseUrl(`/annotations/${newAnnotation.typ}/${newAnnotation.id}`);
    await api.tracing.restart(null, newAnnotation.id, ControlModeEnum.TRACE, undefined, true);
    const sandboxSkeletonTracing = enforceSkeletonTracing(sandboxTracing);
    const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
    // Update the sandbox tracing with the new tracingId and createdTimestamp
    const newSkeletonTracing = {
      ...sandboxSkeletonTracing,
      tracingId: skeletonTracing.tracingId,
      createdTimestamp: skeletonTracing.createdTimestamp,
    };
    Store.dispatch(setTracingAction(newSkeletonTracing));
    await Model.ensureSavedState();
    // Do a complete page refresh, because the URL changed and the router
    // would cause a reload the next time the URL hash changes (because the
    // TracingLayoutView would be remounted).
    location.reload();
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

  getTracingViewModals() {
    const { viewMode } = Store.getState().temporaryConfiguration;
    const isSkeletonMode = Constants.MODES_SKELETON.includes(viewMode);
    const {
      restrictions,
      annotationType,
      annotationId,
      activeUser,
      isZarrPrivateLinksModalOpen,
      isUserScriptsModalOpen,
      isMergeModalOpen,
      isShareModalOpen,
      isRenderAnimationModalOpen,
      isDownloadModalOpen,
    } = this.props;
    const modals = [];

    modals.push(
      <ShareModalView
        key="share-modal"
        isOpen={isShareModalOpen}
        onOk={handleShareClose}
        annotationType={annotationType}
        annotationId={annotationId}
      />,
    );
    modals.push(
      <PrivateLinksModal
        key="private-links-modal"
        isOpen={isZarrPrivateLinksModalOpen}
        onOk={handleZarrLinksClose}
        annotationId={annotationId}
      />,
    );

    modals.push(
      <CreateAnimationModal
        key="render-animation-modal"
        isOpen={isRenderAnimationModalOpen}
        onClose={() => Store.dispatch(setRenderAnimationModalVisibilityAction(false))}
      />,
    );

    modals.push(
      <UserScriptsModalView
        key="user-scripts-modal"
        isOpen={isUserScriptsModalOpen}
        onOK={handleUserScriptsClose}
      />,
    );

    if (restrictions.allowDownload) {
      modals.push(
        <DownloadModalView
          key="download-modal"
          isAnnotation
          isOpen={isDownloadModalOpen}
          onClose={handleDownloadClose}
        />,
      );
    }

    if (restrictions.allowSave && isSkeletonMode && activeUser != null) {
      modals.push(
        <MergeModalView key="merge-modal" isOpen={isMergeModalOpen} onOk={handleMergeClose} />,
      );
    }

    return modals;
  }

  render() {
    const {
      hasTracing,
      restrictions,
      task,
      activeUser,
      busyBlockingInfo,
      annotationOwner,
      layoutMenu,
    } = this.props;

    const isAnnotationOwner = activeUser && annotationOwner?.id === activeUser?.id;
    const copyAnnotationText = isAnnotationOwner ? "Duplicate" : "Copy To My Account";

    const saveButton = restrictions.allowUpdate
      ? [
          hasTracing
            ? [
                <AsyncButton
                  className="narrow undo-redo-button"
                  key="undo-button"
                  title="Undo (Ctrl+Z)"
                  onClick={this.handleUndo}
                  disabled={busyBlockingInfo.isBusy}
                  hideContentWhenLoading
                >
                  <i className="fas fa-undo" aria-hidden="true" />
                </AsyncButton>,
                <AsyncButton
                  className="narrow undo-redo-button hide-on-small-screen"
                  key="redo-button"
                  title="Redo (Ctrl+Y)"
                  onClick={this.handleRedo}
                  disabled={busyBlockingInfo.isBusy}
                  hideContentWhenLoading
                >
                  <i className="fas fa-redo" aria-hidden="true" />
                </AsyncButton>,
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
                title={copyAnnotationText}
              >
                <span className="hide-on-small-screen">Copy To My Account</span>
              </AsyncButtonWithAuthentication>,
            ]
          ),
        ]
      : [
          <ButtonComponent
            key="read-only-button"
            danger
            disabled
            style={{
              backgroundColor: "var(--ant-color-warning)",
            }}
          >
            Read only
          </ButtonComponent>,
          <AsyncButtonWithAuthentication
            activeUser={activeUser}
            authenticationMessage="Please register or login to copy the tracing to your account."
            key="copy-button"
            icon={<FileAddOutlined />}
            onClick={this.handleCopyToAccount}
            title={copyAnnotationText}
          >
            <span className="hide-on-small-screen">{copyAnnotationText}</span>
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

    const modals = this.getTracingViewModals();
    const menuItems = getTracingViewMenuItems(this.props, layoutMenu);
    const userTheme = getThemeFromUser(activeUser);

    return (
      <>
        <Space.Compact>
          {saveButton}
          {finishAndNextTaskButton}
          {reopenTaskButton}
        </Space.Compact>
        <ConfigProvider theme={{ ...getAntdTheme(userTheme) }}>{modals}</ConfigProvider>
        <div>
          <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
            <ButtonComponent className="narrow">
              Menu
              <DownOutlined />
            </ButtonComponent>
          </Dropdown>
        </div>
      </>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  return {
    annotationType: state.tracing.annotationType,
    annotationId: state.tracing.annotationId,
    restrictions: state.tracing.restrictions,
    annotationOwner: state.tracing.owner,
    task: state.task,
    activeUser: state.activeUser,
    hasTracing: state.tracing.skeleton != null || state.tracing.volumes.length > 0,
    isDownloadModalOpen: state.uiInformation.showDownloadModal,
    isShareModalOpen: state.uiInformation.showShareModal,
    isRenderAnimationModalOpen: state.uiInformation.showRenderAnimationModal,
    busyBlockingInfo: state.uiInformation.busyBlockingInfo,
    isAnnotationLockedByUser: state.tracing.isLockedByOwner,
    annotationTags: state.tracing.tags,
    isMergeModalOpen: state.uiInformation.showMergeAnnotationModal,
    isUserScriptsModalOpen: state.uiInformation.showAddScriptModal,
    isZarrPrivateLinksModalOpen: state.uiInformation.showZarrPrivateLinksModal,
  };
}

const connector = connect(mapStateToProps);
export default connector(TracingActionsView);
