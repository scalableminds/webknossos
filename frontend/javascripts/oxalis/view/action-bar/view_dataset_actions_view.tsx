import React from "react";
import { Dropdown, Menu } from "antd";
import { ShareAltOutlined, DownOutlined, CameraOutlined, CodeOutlined } from "@ant-design/icons";
import ButtonComponent from "oxalis/view/components/button_component";
import ShareViewDatasetModalView from "oxalis/view/action-bar/share_view_dataset_modal_view";
import { downloadScreenshot } from "oxalis/view/rendering_utils";
import {
  setPythonClientModalVisibilityAction,
  setShareModalVisibilityAction,
} from "oxalis/model/actions/ui_actions";
import Store from "oxalis/store";
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
  const shareDatasetModal = (
    <ShareViewDatasetModalView onOk={() => Store.dispatch(setShareModalVisibilityAction(false))} />
  );
  const pythonClientModal = (
    <PythonClientModalView
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
        <CodeOutlined />
        Python Client
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
          <DownOutlined />
        </ButtonComponent>
      </Dropdown>
    </div>
  );
}
