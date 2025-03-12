import {
  CameraOutlined,
  DownOutlined,
  DownloadOutlined,
  ShareAltOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { ConfigProvider, Dropdown, type MenuProps } from "antd";
import type { MenuItemType, SubMenuType } from "antd/lib/menu/interface";
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
import { getAntdTheme, getThemeFromUser } from "theme";
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

export const viewDatasetMenu = [
  shareModalMenuItem,
  screenshotMenuItem,
  renderAnimationMenuItem,
  pythonClientMenuItem,
];

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
  const overlayMenu: MenuProps = { items: [...viewDatasetMenu, props.layoutMenu] };

  const renderAnimationModal = (
    <CreateAnimationModal
      isOpen={isRenderAnimationModalOpen}
      onClose={() => Store.dispatch(setRenderAnimationModalVisibilityAction(false))}
    />
  );

  const userTheme = getThemeFromUser(activeUser);

  return (
    <div
      style={{
        marginLeft: 10,
      }}
    >
      <ConfigProvider theme={{ ...getAntdTheme(userTheme) }}>
        {shareDatasetModal}
        {pythonClientModal}
        {activeUser?.isSuperUser ? renderAnimationModal : null}
      </ConfigProvider>
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
