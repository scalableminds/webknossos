import {
  CameraOutlined,
  DownloadOutlined,
  DownOutlined,
  LaptopOutlined,
  ShareAltOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Dropdown, type MenuProps } from "antd";
import type { MenuItemType, SubMenuType } from "antd/es/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { UserThemeConfigProvider } from "theme_provider";
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

  return (
    <div>
      <UserThemeConfigProvider>
        {shareDatasetModal}
        {renderAnimationModal}
        {keyboardShortcutsConfigModal}
        {pythonClientModal}
      </UserThemeConfigProvider>
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
