import {
  CameraOutlined,
  DownloadOutlined,
  DownOutlined,
  LaptopOutlined,
  ShareAltOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { ConfigProvider, Dropdown, type MenuProps } from "antd";
import type { MenuItemType, SubMenuType } from "antd/lib/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { getAntdTheme, getThemeFromUser } from "theme";
import {
  setKeyboardShortcutConfigModalVisibilityAction,
  setPythonClientModalVisibilityAction,
  setRenderAnimationModalVisibilityAction,
  setShareModalVisibilityAction,
} from "viewer/model/actions/ui_actions";
import Store from "viewer/store";
import ShareViewDatasetModalView from "viewer/view/action_bar/share_view_dataset_modal_view";
import ButtonComponent from "viewer/view/components/button_component";
import { downloadScreenshot } from "viewer/view/rendering_utils";
import KeyboardShortcutConfigModal from "../keyboard_shortcuts/keyboard_shortcut_config_modal";
import CreateAnimationModal from "./create_animation_modal";
import DownloadModalView from "./download_modal/download_modal_view";

type Props = {
  layoutMenu: SubMenuType;
};

export const screenshotMenuItem: MenuItemType = {
  key: "screenshot-button",
  onClick: downloadScreenshot,
  icon: <CameraOutlined />,
  label: "Screenshot (Q)",
};

export const renderAnimationMenuItem: MenuItemType = {
  key: "create-animation-button",
  label: "Create Animation",
  icon: <VideoCameraOutlined />,
  onClick: () => {
    Store.dispatch(setRenderAnimationModalVisibilityAction(true));
  },
};

const shareModalMenuItem: MenuItemType = {
  key: "share-button",
  onClick: () => Store.dispatch(setShareModalVisibilityAction(true)),
  icon: <ShareAltOutlined />,
  label: "Share",
};

const keyboardShortcutsConfigMenuItem: MenuItemType = {
  key: "Keyboard Shortcuts",
  onClick: () => Store.dispatch(setKeyboardShortcutConfigModalVisibilityAction(true)),
  icon: <LaptopOutlined />,
  label: "Keyboard Shortcuts",
};

const pythonClientMenuItem: MenuItemType = {
  key: "python-client-button",
  onClick: () => Store.dispatch(setPythonClientModalVisibilityAction(true)),
  icon: <DownloadOutlined />,
  label: "Download",
};

export const viewDatasetMenu = [
  shareModalMenuItem,
  screenshotMenuItem,
  renderAnimationMenuItem,
  keyboardShortcutsConfigMenuItem,
  pythonClientMenuItem,
];

export default function ViewDatasetActionsView(props: Props) {
  const dispatch = useDispatch();
  const activeUser = useWkSelector((state) => state.activeUser);
  const isShareModalOpen = useWkSelector((state) => state.uiInformation.showShareModal);
  const showKeyboardShortcutConfigModal = useWkSelector(
    (state) => state.uiInformation.showKeyboardShortcutConfigModal,
  );
  const isPythonClientModalOpen = useWkSelector(
    (state) => state.uiInformation.showPythonClientModal,
  );
  const isRenderAnimationModalOpen = useWkSelector(
    (state) => state.uiInformation.showRenderAnimationModal,
  );
  const handleCloseShareDatasetModal = useCallback(() => {
    dispatch(setShareModalVisibilityAction(false));
  }, [dispatch]);
  const handleCloseKeyboardShortcutsConfigModal = useCallback(() => {
    dispatch(setKeyboardShortcutConfigModalVisibilityAction(false));
  }, [dispatch]);
  const handleClosePythonClientModal = useCallback(() => {
    dispatch(setPythonClientModalVisibilityAction(false));
  }, [dispatch]);

  const shareDatasetModal = (
    <ShareViewDatasetModalView isOpen={isShareModalOpen} onOk={handleCloseShareDatasetModal} />
  );

  const keyboardShortcutsConfigModal = (
    <KeyboardShortcutConfigModal
      isOpen={showKeyboardShortcutConfigModal}
      onClose={handleCloseKeyboardShortcutsConfigModal}
    />
  );

  const pythonClientModal = (
    <DownloadModalView
      isAnnotation={false}
      initialTab="export"
      isOpen={isPythonClientModalOpen}
      onClose={handleClosePythonClientModal}
    />
  );

  const overlayMenu: MenuProps = { items: [...viewDatasetMenu, props.layoutMenu] };

  const renderAnimationModal = (
    <CreateAnimationModal
      isOpen={isRenderAnimationModalOpen}
      onClose={() => dispatch(setRenderAnimationModalVisibilityAction(false))}
    />
  );

  const userTheme = getThemeFromUser(activeUser);

  return (
    <div>
      <ConfigProvider theme={getAntdTheme(userTheme)}>
        {shareDatasetModal}
        {renderAnimationModal}
        {keyboardShortcutsConfigModal}
        {pythonClientModal}
      </ConfigProvider>
      <Dropdown menu={overlayMenu} trigger={["click"]}>
        <ButtonComponent
          style={{
            padding: "0 10px",
          }}
          icon={<DownOutlined />}
          iconPlacement="end"
        >
          Menu
        </ButtonComponent>
      </Dropdown>
    </div>
  );
}
