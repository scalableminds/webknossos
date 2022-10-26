import React from "react";
import { useSelector } from "react-redux";
import { Dropdown, Menu } from "antd";
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
import PythonClientModalView from "./python_client_modal_view";

type Props = {
  layoutMenu: React.ReactNode;
};
export const screenshotMenuItem = (
  <Menu.Item key="screenshot-button" onClick={downloadScreenshot}>
    <CameraOutlined />
    Screenshot (Q)
  </Menu.Item>
);
export default function ViewDatasetActionsView(props: Props) {
  const isShareModalOpen = useSelector((state: OxalisState) => state.uiInformation.showShareModal);
  const isPythonClientModalOpen = useSelector(
    (state: OxalisState) => state.uiInformation.showPythonClientModal,
  );
  const shareDatasetModal = (
    <ShareViewDatasetModalView
      isVisible={isShareModalOpen}
      onOk={() => Store.dispatch(setShareModalVisibilityAction(false))}
    />
  );
  const pythonClientModal = (
    <PythonClientModalView
      isVisible={isPythonClientModalOpen}
      onClose={() => Store.dispatch(setPythonClientModalVisibilityAction(false))}
    />
  );
  const overlayMenu = (
    <Menu>
      <Menu.Item
        key="share-button"
        onClick={() => Store.dispatch(setShareModalVisibilityAction(true))}
      >
        <ShareAltOutlined />
        Share
      </Menu.Item>
      {screenshotMenuItem}
      <Menu.Item
        key="python-client-button"
        onClick={() => Store.dispatch(setPythonClientModalVisibilityAction(true))}
      >
        <DownloadOutlined />
        Download
      </Menu.Item>
      {props.layoutMenu}
    </Menu>
  );
  return (
    <div
      style={{
        marginLeft: 10,
      }}
    >
      {shareDatasetModal}
      {pythonClientModal}
      <Dropdown overlay={overlayMenu} trigger={["click"]}>
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
