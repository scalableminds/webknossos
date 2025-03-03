import {
  CameraOutlined,
  DownOutlined,
  DownloadOutlined,
  ShareAltOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Dropdown, type MenuProps } from "antd";
import type { ItemType, MenuItemType, SubMenuType } from "antd/lib/menu/interface";
import {
  setPythonClientModalVisibilityAction,
  setRenderAnimationModalVisibilityAction,
  setShareModalVisibilityAction,
} from "oxalis/model/actions/ui_actions";
import Store, { type OxalisState } from "oxalis/store";
import ShareViewDatasetModalView from "oxalis/view/action-bar/share_view_dataset_modal_view";
import ButtonComponent from "oxalis/view/components/button_component";
import { downloadScreenshot } from "oxalis/view/rendering_utils";
import { useSelector } from "react-redux";
import CreateAnimationModal from "./create_animation_modal";
import DownloadModalView from "./download_modal_view";

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

export const getViewDatasetMenu = (layoutMenu: SubMenuType<MenuItemType> | null) => {
  const items: Array<ItemType> = [
    {
      key: "share-button",
      onClick: () => Store.dispatch(setShareModalVisibilityAction(true)),
      icon: <ShareAltOutlined />,
      label: "Share",
    },
    screenshotMenuItem,
    renderAnimationMenuItem,
    {
      key: "python-client-button",
      onClick: () => Store.dispatch(setPythonClientModalVisibilityAction(true)),
      icon: <DownloadOutlined />,
      label: "Download",
    },
  ];
  if (layoutMenu != null) items.push(layoutMenu);
  return { items };
};

export default function ViewDatasetActionsView(props: Props) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const isShareModalOpen = useSelector((state: OxalisState) => state.uiInformation.showShareModal);
  const isPythonClientModalOpen = useSelector(
    (state: OxalisState) => state.uiInformation.showPythonClientModal,
  );
  const isRenderAnimationModalOpen = useSelector(
    (state: OxalisState) => state.uiInformation.showRenderAnimationModal,
  );

  const shareDatasetModal = (
    <ShareViewDatasetModalView
      isOpen={isShareModalOpen}
      onOk={() => Store.dispatch(setShareModalVisibilityAction(false))}
    />
  );
  const pythonClientModal = (
    <DownloadModalView
      isAnnotation={false}
      initialTab="export"
      isOpen={isPythonClientModalOpen}
      onClose={() => Store.dispatch(setPythonClientModalVisibilityAction(false))}
    />
  );
  const overlayMenu: MenuProps = getViewDatasetMenu(props.layoutMenu);

  const renderAnimationModal = (
    <CreateAnimationModal
      isOpen={isRenderAnimationModalOpen}
      onClose={() => Store.dispatch(setRenderAnimationModalVisibilityAction(false))}
    />
  );

  return (
    <div
      style={{
        marginLeft: 10,
      }}
    >
      {shareDatasetModal}
      {pythonClientModal}
      {activeUser?.isSuperUser ? renderAnimationModal : null}
      <Dropdown menu={overlayMenu} trigger={["click"]}>
        <ButtonComponent
          style={{
            padding: "0 10px",
          }}
        >
          Menu <DownOutlined />
        </ButtonComponent>
      </Dropdown>
    </div>
  );
}
