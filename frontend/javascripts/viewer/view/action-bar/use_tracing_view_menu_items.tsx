import {
  CheckCircleOutlined,
  CopyOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  LinkOutlined,
  LockOutlined,
  SettingOutlined,
  ShareAltOutlined,
  StopOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { duplicateAnnotation, editLockedState, finishAnnotation } from "admin/rest_api";
import { Modal } from "antd";
import type { ItemType, SubMenuType } from "antd/es/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { location } from "libs/window";
import messages from "messages";
import * as React from "react";
import type { APIAnnotationType, APIUser, APIUserBase } from "types/api_types";
import Constants, { ControlModeEnum } from "viewer/constants";
import { disableSavingAction } from "viewer/model/actions/save_actions";
import {
  setDownloadModalVisibilityAction,
  setMergeModalVisibilityAction,
  setShareModalVisibilityAction,
  setUserScriptsModalVisibilityAction,
  setVersionRestoreVisibilityAction,
  setZarrLinksModalVisibilityAction,
} from "viewer/model/actions/ui_actions";
import { Model } from "viewer/singletons";
import type { RestrictionsAndSettings, Task } from "viewer/store";
import Store from "viewer/store";
import {
  renderAnimationMenuItem,
  screenshotMenuItem,
} from "viewer/view/action-bar/view_dataset_actions_view";

// These handlers are moved from TracingActionsView.tsx
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

const handleDownloadOpen = () => {
  Store.dispatch(setDownloadModalVisibilityAction(true));
};

const handleMergeOpen = () => {
  Store.dispatch(setMergeModalVisibilityAction(true));
};

const handleUserScriptsOpen = () => {
  Store.dispatch(setUserScriptsModalVisibilityAction(true));
};

const handleZarrLinksOpen = () => {
  Store.dispatch(setZarrLinksModalVisibilityAction(true));
};

const handleChangeLockedStateOfAnnotation = async (
  isLocked: boolean,
  annotationId: string,
  annotationType: APIAnnotationType,
) => {
  try {
    await Model.ensureSavedState();
    await editLockedState(annotationId, annotationType, isLocked);
    Toast.success(
      isLocked ? messages["annotation.lock.success"] : messages["annotation.unlock.success"],
    );
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
      location.href = "/dashboard";
    },
  });
};

const handleDuplicate = async (annotationId: string, annotationType: APIAnnotationType) => {
  await Model.ensureSavedState();
  const newAnnotation = await duplicateAnnotation(annotationId, annotationType);
  window.open(`/annotations/${newAnnotation.id}`, "_blank", "noopener,noreferrer");
};

export type TracingViewMenuProps = {
  restrictions: RestrictionsAndSettings;
  task: Task | null | undefined;
  annotationType: APIAnnotationType;
  annotationId: string;
  activeUser: APIUser | null | undefined;
  isAnnotationLockedByUser: boolean;
  annotationOwner: APIUserBase | null | undefined;
};

export const useTracingViewMenuItems = (
  props: TracingViewMenuProps,
  layoutMenu: SubMenuType | null,
) => {
  // Explicitly use very "precise" selectors to avoid unnecessary re-renders
  const viewMode = useWkSelector((state) => state.temporaryConfiguration.viewMode);
  const controlMode = useWkSelector((state) => state.temporaryConfiguration.controlMode);

  const {
    restrictions,
    task,
    annotationType,
    annotationId,
    activeUser,
    isAnnotationLockedByUser,
    annotationOwner,
  } = props;

  return React.useMemo(() => {
    const isSkeletonMode = Constants.MODES_SKELETON.includes(viewMode);
    const isAnnotationOwner = activeUser && annotationOwner?.id === activeUser?.id;
    const archiveButtonText = task ? "Finish and go to Dashboard" : "Archive";
    const menuItems: ItemType[] = [];

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
  }, [
    viewMode,
    controlMode,
    restrictions,
    task,
    annotationType,
    annotationId,
    activeUser,
    isAnnotationLockedByUser,
    annotationOwner,
    layoutMenu,
  ]);
};
