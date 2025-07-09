import { ConfigProvider } from "antd";
import { useWkSelector } from "libs/react_hooks";
import * as React from "react";
import { getAntdTheme, getThemeFromUser } from "theme";
import Constants from "viewer/constants";
import {
  setDownloadModalVisibilityAction,
  setMergeModalVisibilityAction,
  setRenderAnimationModalVisibilityAction,
  setShareModalVisibilityAction,
  setUserScriptsModalVisibilityAction,
  setZarrLinksModalVisibilityAction,
} from "viewer/model/actions/ui_actions";
import Store from "viewer/store";
import DownloadModalView from "viewer/view/action-bar/download_modal_view";
import MergeModalView from "viewer/view/action-bar/merge_modal_view";
import ShareModalView from "viewer/view/action-bar/share_modal_view";
import UserScriptsModalView from "viewer/view/action-bar/user_scripts_modal_view";
import CreateAnimationModal from "./create_animation_modal";
import { PrivateLinksModal } from "./private_links_view";

const handleShareClose = () => {
  Store.dispatch(setShareModalVisibilityAction(false));
};

const handleDownloadClose = () => {
  Store.dispatch(setDownloadModalVisibilityAction(false));
};

const handleMergeClose = () => {
  Store.dispatch(setMergeModalVisibilityAction(false));
};

const handleUserScriptsClose = () => {
  Store.dispatch(setUserScriptsModalVisibilityAction(false));
};

const handleZarrLinksClose = () => {
  Store.dispatch(setZarrLinksModalVisibilityAction(false));
};

function TracingModals() {
  const {
    annotation: { annotationType, annotationId, restrictions },
    activeUser,
    uiInformation: {
      showDownloadModal,
      showShareModal,
      showRenderAnimationModal,
      showMergeAnnotationModal,
      showAddScriptModal,
      showZarrPrivateLinksModal,
    },
    temporaryConfiguration: { viewMode },
  } = useWkSelector((state) => ({
    annotation: state.annotation,
    activeUser: state.activeUser,
    uiInformation: state.uiInformation,
    temporaryConfiguration: state.temporaryConfiguration,
  }));

  const modals = React.useMemo(() => {
    const isSkeletonMode = Constants.MODES_SKELETON.includes(viewMode);
    const modalList = [];

    modalList.push(
      <ShareModalView
        key="share-modal"
        isOpen={showShareModal}
        onOk={handleShareClose}
        annotationType={annotationType}
        annotationId={annotationId}
      />,
    );
    modalList.push(
      <PrivateLinksModal
        key="private-links-modal"
        isOpen={showZarrPrivateLinksModal}
        onOk={handleZarrLinksClose}
        annotationId={annotationId}
      />,
    );

    modalList.push(
      <CreateAnimationModal
        key="render-animation-modal"
        isOpen={showRenderAnimationModal}
        onClose={() => Store.dispatch(setRenderAnimationModalVisibilityAction(false))}
      />,
    );

    modalList.push(
      <UserScriptsModalView
        key="user-scripts-modal"
        isOpen={showAddScriptModal}
        onOK={handleUserScriptsClose}
      />,
    );

    if (restrictions.allowDownload) {
      modalList.push(
        <DownloadModalView
          key="download-modal"
          isAnnotation
          isOpen={showDownloadModal}
          onClose={handleDownloadClose}
        />,
      );
    }

    if (restrictions.allowSave && isSkeletonMode && activeUser != null) {
      modalList.push(
        <MergeModalView
          key="merge-modal"
          isOpen={showMergeAnnotationModal}
          onOk={handleMergeClose}
        />,
      );
    }

    return modalList;
  }, [
    activeUser,
    showDownloadModal,
    showMergeAnnotationModal,
    showZarrPrivateLinksModal,
    showShareModal,
    showAddScriptModal,
    showRenderAnimationModal,
    viewMode,
    annotationId,
    annotationType,
    restrictions,
  ]);

  const userTheme = getThemeFromUser(activeUser);

  return <ConfigProvider theme={getAntdTheme(userTheme)}>{modals}</ConfigProvider>;
}

export default TracingModals;
