import { DownOutlined } from "@ant-design/icons";
import { Dropdown, type MenuProps } from "antd";
import type { SubMenuType } from "antd/es/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import { UserThemeConfigProvider } from "theme_provider";
import {
  setKeyboardShortcutConfigModalVisibilityAction,
  setPythonClientModalVisibilityAction,
  setRenderAnimationModalVisibilityAction,
  setShareModalVisibilityAction,
} from "viewer/model/actions/ui_actions";
import ShareViewDatasetModalView from "viewer/view/action_bar/share_view_dataset_modal_view";
import ButtonComponent from "viewer/view/components/button_component";
import KeyboardShortcutConfigModal from "../keyboard_shortcuts/keyboard_shortcut_config_modal";
import CreateAnimationModal from "./create_animation_modal";
import DownloadModalView from "./download_modal/download_modal_view";
import { toGroupedMenuItems } from "./menu_groups";
import { getViewDatasetMenuGroups } from "./menu_items";

type Props = {
  layoutMenu: SubMenuType | null;
};

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

  const overlayMenu: MenuProps = useMemo(
    () => ({ items: toGroupedMenuItems(getViewDatasetMenuGroups(props.layoutMenu)) }),
    [props.layoutMenu],
  );

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
