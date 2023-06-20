import React from "react";
import { useSelector } from "react-redux";
import { Dropdown, MenuProps } from "antd";
import {
  ShareAltOutlined,
  DownOutlined,
  CameraOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import ButtonComponent from "oxalis/view/components/button_component";
import ShareViewDatasetModalView from "oxalis/view/action-bar/share_view_dataset_modal_view";
import { downloadScreenshot } from "oxalis/view/rendering_utils";
import {
  setPythonClientModalVisibilityAction,
  setShareModalVisibilityAction,
} from "oxalis/model/actions/ui_actions";
import Store, { OxalisState } from "oxalis/store";
import { MenuItemType, SubMenuType } from "antd/lib/menu/hooks/useItems";
import DownloadModalView from "./download_modal_view";
import features from "features";
import { getAISegmentationMenu } from "./tracing_actions_view";

type Props = {
  layoutMenu: SubMenuType;
};
export const screenshotMenuItem: MenuItemType = {
  key: "screenshot-button",
  onClick: downloadScreenshot,
  icon: <CameraOutlined />,
  label: "Screenshot (Q)",
};

export default function ViewDatasetActionsView(props: Props) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const isShareModalOpen = useSelector((state: OxalisState) => state.uiInformation.showShareModal);
  const isAINucleiSegmentationModalOpen = useSelector(
    (state: OxalisState) => state.uiInformation.showAINucleiSegmentationModal,
  );
  const isAINeuronSegmentationModalOpen = useSelector(
    (state: OxalisState) => state.uiInformation.showAINeuronSegmentationModal,
  );
  const isPythonClientModalOpen = useSelector(
    (state: OxalisState) => state.uiInformation.showPythonClientModal,
  );

  const [AISegmentationMenu, AISegmentationModals] = getAISegmentationMenu(
    isAINucleiSegmentationModalOpen,
    isAINeuronSegmentationModalOpen,
  );
  const isAISegmentationEnabled =
    features().jobsEnabled && activeUser != null && activeUser.isSuperUser;

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
  const overlayMenu: MenuProps = {
    items: [
      {
        key: "share-button",
        onClick: () => Store.dispatch(setShareModalVisibilityAction(true)),
        icon: <ShareAltOutlined />,
        label: "Share",
      },
      screenshotMenuItem,
      {
        key: "python-client-button",
        onClick: () => Store.dispatch(setPythonClientModalVisibilityAction(true)),
        icon: <DownloadOutlined />,
        label: "Download",
      },
      isAISegmentationEnabled ? AISegmentationMenu : null,
      props.layoutMenu,
    ],
  };

  return (
    <div
      style={{
        marginLeft: 10,
      }}
    >
      {shareDatasetModal}
      {pythonClientModal}
      {isAISegmentationEnabled ? AISegmentationModals : null}
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
