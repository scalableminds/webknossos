// @flow
import React, { useState, type Node } from "react";
import { Dropdown, Menu } from "antd";
import { ShareAltOutlined, DownOutlined, CameraOutlined } from "@ant-design/icons";
import ButtonComponent from "oxalis/view/components/button_component";
import ShareViewDatasetModalView from "oxalis/view/action-bar/share_view_dataset_modal_view";
import { downloadScreenshot } from "oxalis/view/rendering_utils";

type Props = {
  layoutMenu: Node,
};

export const screenshotMenuItem = (
  <Menu.Item key="screenshot-button" onClick={downloadScreenshot}>
    <CameraOutlined />
    Screenshot (Q)
  </Menu.Item>
);

export default function ViewDatasetActionsView(props: Props) {
  const [shareDatasetModalVisibility, setShareDatasetModalVisibility] = useState(false);
  const modal = (
    <ShareViewDatasetModalView
      isVisible={shareDatasetModalVisibility}
      onOk={() => setShareDatasetModalVisibility(false)}
    />
  );
  const overlayMenu = (
    <Menu>
      <Menu.Item key="share-button" onClick={() => setShareDatasetModalVisibility(true)}>
        <ShareAltOutlined />
        Share
      </Menu.Item>
      {screenshotMenuItem}
      {props.layoutMenu}
    </Menu>
  );

  return (
    <div style={{ marginLeft: 10 }}>
      {modal}
      <Dropdown overlay={overlayMenu} trigger={["click"]}>
        <ButtonComponent style={{ padding: "0 10px" }}>
          <DownOutlined />
        </ButtonComponent>
      </Dropdown>
    </div>
  );
}
