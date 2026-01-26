import { ConfigProvider } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
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
import DownloadModalView from "viewer/view/action-bar/download_modal_view";
import MergeModalView from "viewer/view/action-bar/merge_modal_view";
import ShareModalView from "viewer/view/action-bar/share_modal_view";
import UserScriptsModalView from "viewer/view/action-bar/user_scripts_modal_view";
import CreateAnimationModal from "./create_animation_modal";
import { PrivateLinksModal } from "./private_links_view";

function TracingModals() {
  const dispatch = useDispatch();

  const annotationType = useWkSelector((state) => state.annotation.annotationType);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const restrictions = useWkSelector((state) => state.annotation.restrictions);
  const activeUser = useWkSelector((state) => state.activeUser);
  const showDownloadModal = useWkSelector((state) => state.uiInformation.showDownloadModal);
  const showShareModal = useWkSelector((state) => state.uiInformation.showShareModal);
  const showRenderAnimationModal = useWkSelector(
    (state) => state.uiInformation.showRenderAnimationModal,
  );
  const showMergeAnnotationModal = useWkSelector(
    (state) => state.uiInformation.showMergeAnnotationModal,
  );
  const showAddScriptModal = useWkSelector((state) => state.uiInformation.showAddScriptModal);
  const showZarrPrivateLinksModal = useWkSelector(
    (state) => state.uiInformation.showZarrPrivateLinksModal,
  );
  const viewMode = useWkSelector((state) => state.temporaryConfiguration.viewMode);

  const handleShareClose = useCallback(() => {
    dispatch(setShareModalVisibilityAction(false));
  }, [dispatch]);

  const handleDownloadClose = useCallback(() => {
    dispatch(setDownloadModalVisibilityAction(false));
  }, [dispatch]);

  const handleMergeClose = useCallback(() => {
    dispatch(setMergeModalVisibilityAction(false));
  }, [dispatch]);

  const handleUserScriptsClose = useCallback(() => {
    dispatch(setUserScriptsModalVisibilityAction(false));
  }, [dispatch]);

  const handleZarrLinksClose = useCallback(() => {
    dispatch(setZarrLinksModalVisibilityAction(false));
  }, [dispatch]);

  const handleRenderAnimationClose = useCallback(() => {
    dispatch(setRenderAnimationModalVisibilityAction(false));
  }, [dispatch]);

  const modals = useMemo(() => {
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
        onClose={handleRenderAnimationClose}
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
    handleShareClose,
    handleDownloadClose,
    handleMergeClose,
    handleUserScriptsClose,
    handleZarrLinksClose,
    handleRenderAnimationClose,
  ]);

  const userTheme = getThemeFromUser(activeUser);

  return <ConfigProvider theme={getAntdTheme(userTheme)}>{modals}</ConfigProvider>;
}

export default TracingModals;
