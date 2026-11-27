import {
  CameraOutlined,
  DownloadOutlined,
  LaptopOutlined,
  ShareAltOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { MenuItemType, SubMenuType } from "antd/es/menu/interface";
import {
  setKeyboardShortcutConfigModalVisibilityAction,
  setPythonClientModalVisibilityAction,
  setRenderAnimationModalVisibilityAction,
  setShareModalVisibilityAction,
} from "viewer/model/actions/ui_actions";
import Store from "viewer/store";
import { downloadScreenshot } from "viewer/view/rendering_utils";
import { type MenuGroup, MenuGroupKeys } from "./menu_groups";
import { openInMenu } from "./open_in/open_in_menu";

// Menu entries shared by the dataset view, the annotation view and the command palette. They live
// here instead of in a component module so that importing them doesn't pull in any UI components.

export const screenshotMenuItem: MenuItemType = {
  key: "screenshot-button",
  onClick: downloadScreenshot,
  icon: <CameraOutlined />,
  label: "Screenshot",
};

export const renderAnimationMenuItem: MenuItemType = {
  key: "create-animation-button",
  label: "Create Animation",
  icon: <VideoCameraOutlined />,
  onClick: () => {
    Store.dispatch(setRenderAnimationModalVisibilityAction(true));
  },
};

export const keyboardShortcutsConfigMenuItem: MenuItemType = {
  key: "keyboard-shortcuts-button",
  onClick: () => Store.dispatch(setKeyboardShortcutConfigModalVisibilityAction(true)),
  icon: <LaptopOutlined />,
  label: "Configure Shortcuts",
};

const shareModalMenuItem: MenuItemType = {
  key: "share-button",
  onClick: () => Store.dispatch(setShareModalVisibilityAction(true)),
  icon: <ShareAltOutlined />,
  label: "Share",
};

const pythonClientMenuItem: MenuItemType = {
  key: "python-client-button",
  onClick: () => Store.dispatch(setPythonClientModalVisibilityAction(true)),
  icon: <DownloadOutlined />,
  label: "Download",
};

export function getViewDatasetMenuGroups(layoutMenu: SubMenuType | null): MenuGroup[] {
  return [
    {
      key: MenuGroupKeys.SHARE_AND_EXPORT,
      items: [
        shareModalMenuItem,
        pythonClientMenuItem,
        screenshotMenuItem,
        renderAnimationMenuItem,
        openInMenu,
      ],
    },
    {
      key: MenuGroupKeys.CUSTOMIZE,
      items: [...(layoutMenu != null ? [layoutMenu] : []), keyboardShortcutsConfigMenuItem],
    },
  ];
}
